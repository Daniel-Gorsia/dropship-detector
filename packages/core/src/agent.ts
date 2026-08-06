import Groq from "groq-sdk";
import type { Verdict, AgentStep, SupplierMatch } from "@dropship/shared";
import { TOOL_DEFINITIONS } from "./tools.js";
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


export async function runScan(
  url: string,
  config: AgentConfig
): Promise<ScanResult> {
  const groq = new Groq({ apiKey: config.groqApiKey });
  const maxSerpCalls = config.maxSerpCalls ?? 3;
  let serpCallsUsed = 0;
  const steps: AgentStep[] = [];
  let finalVerdict: Verdict | null = null;
  const supplierMatches: SupplierMatch[] = [];

  function emit(step: AgentStep) {
    steps.push(step);
    config.onStep?.(step);
  }

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Please analyze this URL and determine if it's a dropshipping store: ${url}`,
    },
  ];

  for (let turn = 0; turn < 12; turn++) {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: "auto",
      max_tokens: 4096,
    });

    const message = response.choices[0]?.message;
    if (!message) break;

    // Add assistant turn to history
    messages.push(message);

    // Emit text reasoning
    if (message.content?.trim()) {
      emit({
        type: "reasoning",
        message: message.content,
        timestamp: new Date().toISOString(),
      });
    }

    const finishReason = response.choices[0]?.finish_reason;
    if (finishReason !== "tool_calls" || !message.tool_calls?.length) break;

    // Process all tool calls in this turn
    for (const toolCall of message.tool_calls) {
      const name = toolCall.function.name;
      let inp: Record<string, unknown> = {};
      try {
        inp = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      } catch {
        // malformed JSON — leave inp empty
      }

      emit({
        type: "tool_call",
        tool: name,
        input: inp,
        timestamp: new Date().toISOString(),
      });

      let result: unknown;

      try {
        if (name === "submit_verdict") {
          finalVerdict = inp as unknown as Verdict;
          emit({
            type: "verdict",
            output: finalVerdict,
            timestamp: new Date().toISOString(),
          });
          result = { ok: true };
        } else if (name === "get_store_fingerprint") {
          result = await getStoreFingerprint(String(inp["url"]));
        } else if (name === "check_domain_age") {
          result = await getDomainAge(String(inp["url"]));
        } else if (name === "check_shipping_policy") {
          result = await checkShippingPolicy(String(inp["url"]));
        } else if (name === "check_description_plagiarism") {
          if (!config.serpApiKey) {
            result = { error: "SerpAPI key not configured" };
          } else if (serpCallsUsed >= maxSerpCalls) {
            result = { error: "SerpAPI budget exhausted" };
          } else {
            serpCallsUsed++;
            result = await checkDescriptionPlagiarism(
              String(inp["url"]),
              config.serpApiKey
            );
          }
        } else if (name === "find_supplier_matches") {
          if (!config.serpApiKey) {
            result = { error: "SerpAPI key not configured" };
          } else if (serpCallsUsed >= maxSerpCalls) {
            result = { error: "SerpAPI budget exhausted" };
          } else {
            serpCallsUsed += 2;
            const found = await findSupplierMatches(
              String(inp["url"]),
              config.serpApiKey
            );
            supplierMatches.push(...found);
            result = { matches: found };
          }
        } else if (name === "compare_prices") {
          if (!config.serpApiKey) {
            result = { error: "SerpAPI key not configured" };
          } else if (serpCallsUsed >= maxSerpCalls) {
            result = { error: "SerpAPI budget exhausted" };
          } else {
            serpCallsUsed++;
            result = { results: await googleShoppingSearch(
              String(inp["product_title"]),
              config.serpApiKey
            )};
          }
        } else {
          result = { error: `Unknown tool: ${name}` };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result = { error: message };
        emit({
          type: "error",
          tool: name,
          message,
          timestamp: new Date().toISOString(),
        });
      }

      emit({
        type: "tool_result",
        tool: name,
        output: result,
        timestamp: new Date().toISOString(),
      });

      // Send tool result back as a tool message
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }

    if (finalVerdict) break;
  }

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
