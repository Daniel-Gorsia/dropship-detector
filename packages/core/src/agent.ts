import { generateText, tool } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { z } from "zod";
import type { Verdict, AgentStep, SupplierMatch } from "@dropship/shared";
import { getStoreFingerprint } from "./signals/fingerprint.js";
import { getDomainAge } from "./signals/domain-age.js";
import { checkShippingPolicy } from "./signals/shipping.js";
import { checkDescriptionPlagiarism } from "./signals/description-plagiarism.js";
import { findSupplierMatches } from "./source-finder.js";
import { googleShoppingSearch } from "./signals/serp.js";

export interface AgentConfig {
  groqApiKey: string;
  serpApiKey: string | undefined;
  maxSerpCalls: number | undefined;
  onStep: ((step: AgentStep) => void) | undefined;
}

export interface ScanResult {
  verdict: Verdict;
  supplierMatches: SupplierMatch[];
  steps: AgentStep[];
}

const SYSTEM_PROMPT = `You are a dropshipping detection agent. Given a store or product URL, use tools to gather evidence and output a calibrated verdict.

STEP 1 - Run all three free signals first: get_store_fingerprint, check_domain_age, check_shipping_policy.
STEP 2 - If signals are ambiguous, escalate: check_description_plagiarism, find_supplier_matches, compare_prices (these cost SerpAPI credits).
STEP 3 - Call submit_verdict with a calibrated score.

Scoring guidance:
- Dropship app in HTML (DSers/Oberlo/Zendrop): +30 pts, weight=strong
- Supplier found on AliExpress/Temu: +30 pts, weight=strong
- Shipping mentions 7-20 days or ships from China: +25 pts, weight=strong
- Long shipping 15+ days: +20 pts, weight=strong
- No address or phone anywhere: +15 pts, weight=moderate
- Domain under 6 months: +15 pts, weight=moderate
- No about page: +8 pts, weight=weak
- Generic free Shopify theme: +8 pts, weight=weak
- Physical address found: -10 pts
- Phone number found: -10 pts
- Wix/Squarespace/Weebly platform: -15 pts (rare for dropshippers)
- WooCommerce: -10 pts

Labels: 0-25=unlikely, 26-50=possible, 51-75=likely, 76-100=almost_certain
Confidence: high=2+ strong signals, medium=1 strong + supporting, low=mostly weak.
Never claim a store IS dropshipping — always frame as likelihood.
List every signal found (red flags AND legitimacy signals) in the evidence array.`;

export async function runScan(url: string, config: AgentConfig): Promise<ScanResult> {
  const groq = createGroq({ apiKey: config.groqApiKey });
  const maxSerpCalls = config.maxSerpCalls ?? 3;
  let serpCallsUsed = 0;
  const steps: AgentStep[] = [];
  let finalVerdict: Verdict | null = null;
  const supplierMatches: SupplierMatch[] = [];

  function emit(step: AgentStep) {
    steps.push(step);
    config.onStep?.(step);
  }

  function serpBudgetError(): { error: string } | null {
    if (!config.serpApiKey) return { error: "SerpAPI key not configured" };
    if (serpCallsUsed >= maxSerpCalls) return { error: "SerpAPI budget exhausted" };
    return null;
  }

  // Tools defined with execute functions — SDK handles the loop automatically
  const tools = {
    get_store_fingerprint: tool({
      description: "Fetch the store HTML and detect platform (Shopify/WooCommerce), dropship app traces (DSers, Oberlo, Zendrop), and presence of contact info. Free signal — always run first.",
      parameters: z.object({ url: z.string().url() }),
      execute: async ({ url }) => getStoreFingerprint(url),
    }),

    check_domain_age: tool({
      description: "Look up domain registration date via RDAP. Domains under 6 months old are suspicious. Free signal.",
      parameters: z.object({ url: z.string().url() }),
      execute: async ({ url }) => getDomainAge(url),
    }),

    check_shipping_policy: tool({
      description: "Fetch shipping/policy pages and extract delivery estimates. Long windows (15+ days) or mentions of Chinese warehouses are red flags. Free signal.",
      parameters: z.object({ url: z.string().url() }),
      execute: async ({ url }) => checkShippingPolicy(url),
    }),

    check_description_plagiarism: tool({
      description: "Take a distinctive sentence from the product description and Google-search it exactly. Many stores sharing identical copy = supplier catalog text. Costs 1 SerpAPI credit.",
      parameters: z.object({ url: z.string().url() }),
      execute: async ({ url }) => {
        const err = serpBudgetError();
        if (err) return err;
        serpCallsUsed++;
        return checkDescriptionPlagiarism(url, config.serpApiKey!);
      },
    }),

    find_supplier_matches: tool({
      description: "Reverse-image-search the product photo and title-search AliExpress to find the likely supplier listing. Returns matches with prices — 5x+ markup is a strong signal. Costs 1-2 SerpAPI credits.",
      parameters: z.object({ url: z.string().url() }),
      execute: async ({ url }) => {
        const err = serpBudgetError();
        if (err) return err;
        serpCallsUsed += 2;
        const found = await findSupplierMatches(url, config.serpApiKey!);
        supplierMatches.push(...found);
        return { matches: found };
      },
    }),

    compare_prices: tool({
      description: "Search the product title on Google Shopping to compare price across stores. Costs 1 SerpAPI credit.",
      parameters: z.object({
        product_title: z.string(),
        store_price: z.number().optional(),
      }),
      execute: async ({ product_title }) => {
        const err = serpBudgetError();
        if (err) return err;
        serpCallsUsed++;
        return { results: await googleShoppingSearch(product_title, config.serpApiKey!) };
      },
    }),

    submit_verdict: tool({
      description: "Submit the final verdict. Call this once you have enough evidence to make a calibrated assessment.",
      parameters: z.object({
        score: z.number().min(0).max(100),
        label: z.enum(["unlikely", "possible", "likely", "almost_certain"]),
        confidence: z.enum(["low", "medium", "high"]),
        evidence: z.array(z.object({
          signal: z.string(),
          finding: z.string(),
          direction: z.enum(["dropship", "legit", "neutral"]),
          weight: z.enum(["weak", "moderate", "strong"]),
          sourceUrl: z.string().url().optional(),
        })),
        reasoning: z.string(),
      }),
      execute: async (args) => {
        finalVerdict = args;
        emit({ type: "verdict", output: finalVerdict, timestamp: new Date().toISOString() });
        return { ok: true };
      },
    }),
  };

  await generateText({
    model: groq("llama-3.3-70b-versatile"),
    system: SYSTEM_PROMPT,
    prompt: `Please analyze this URL and determine if it's a dropshipping store: ${url}`,
    tools,
    maxSteps: 10,
    onStepFinish: ({ text, toolCalls, toolResults }) => {
      if (text?.trim()) {
        emit({ type: "reasoning", message: text, timestamp: new Date().toISOString() });
      }
      for (const tc of toolCalls ?? []) {
        emit({ type: "tool_call", tool: tc.toolName, input: tc.args, timestamp: new Date().toISOString() });
      }
      for (const tr of toolResults ?? []) {
        emit({ type: "tool_result", tool: tr.toolName, output: tr.result, timestamp: new Date().toISOString() });
      }
    },
  });

  if (!finalVerdict) {
    finalVerdict = {
      score: 50,
      label: "possible",
      confidence: "low",
      evidence: [],
      reasoning: "Insufficient evidence to make a confident determination.",
    };
  }

  return { verdict: finalVerdict, supplierMatches, steps };
}
