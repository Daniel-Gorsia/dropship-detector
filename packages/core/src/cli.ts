#!/usr/bin/env node
import { runScan } from "./agent.js";
import { getStoreFingerprint } from "./signals/fingerprint.js";
import { getDomainAge } from "./signals/domain-age.js";
import { checkShippingPolicy } from "./signals/shipping.js";

const url: string | undefined = process.argv[2];
if (!url) {
  console.error("Usage: dropship-cli <url> [--full]");
  process.exit(1);
}

const full = process.argv.includes("--full");
const groqKey: string | undefined = process.env["GROQ_API_KEY"];
const serpKey: string | undefined = process.env["SERPAPI_KEY"];

if (full && !groqKey) {
  console.error("GROQ_API_KEY required for --full scan");
  process.exit(1);
}

async function main() {
  console.log(`\nAnalyzing: ${url}\n`);

  if (!full) {
    // Free signals only
    console.log("=== Store Fingerprint ===");
    const fp = await getStoreFingerprint(url as string);
    console.log(JSON.stringify(fp, null, 2));

    console.log("\n=== Domain Age ===");
    const age = await getDomainAge(url as string);
    console.log(JSON.stringify(age, null, 2));

    console.log("\n=== Shipping Policy ===");
    const shipping = await checkShippingPolicy(url as string);
    console.log(JSON.stringify(shipping, null, 2));

    console.log("\nRun with --full to run the full agent loop (requires GROQ_API_KEY)");
    return;
  }

  const result = await runScan(url as string, {
    groqApiKey: groqKey ?? "",
    serpApiKey: serpKey,
    maxSerpCalls: undefined,
    onStep: (step) => {
      if (step.type === "tool_call") {
        console.log(`\n[→] ${step.tool}(${JSON.stringify(step.input).slice(0, 80)})`);
      } else if (step.type === "tool_result") {
        const out = JSON.stringify(step.output).slice(0, 200);
        console.log(`[←] ${step.tool}: ${out}`);
      } else if (step.type === "reasoning") {
        console.log(`\n[thinking] ${String(step.message).slice(0, 300)}`);
      } else if (step.type === "verdict") {
        console.log("\n[✓] Verdict submitted");
      } else if (step.type === "error") {
        console.log(`[!] Error in ${step.tool}: ${step.message}`);
      }
    },
  });

  console.log("\n\n=== VERDICT ===");
  console.log(`Score: ${result.verdict.score}/100 (${result.verdict.label})`);
  console.log(`Confidence: ${result.verdict.confidence}`);
  console.log(`\nReasoning:\n${result.verdict.reasoning}`);
  console.log("\nEvidence:");
  for (const e of result.verdict.evidence) {
    const arrow = e.direction === "dropship" ? "▲" : e.direction === "legit" ? "▼" : "─";
    console.log(`  ${arrow} [${e.weight}] ${e.signal}: ${e.finding}`);
    if (e.sourceUrl) console.log(`       ${e.sourceUrl}`);
  }

  if (result.supplierMatches.length > 0) {
    console.log("\nSupplier Matches:");
    for (const m of result.supplierMatches) {
      const markup = m.markupMultiplier ? `(${m.markupMultiplier}x markup)` : "";
      const price = m.price ? `$${m.price}` : "unknown price";
      console.log(`  • ${m.marketplace}: ${price} ${markup}`);
      console.log(`    ${m.url}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
