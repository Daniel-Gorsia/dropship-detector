#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  runScan,
  getStoreFingerprint,
  getDomainAge,
  checkShippingPolicy,
  findSupplierMatches,
  googleShoppingSearch,
} from "@dropship/core";

const groqKey = process.env["GROQ_API_KEY"] ?? "";
const serpKey = process.env["SERPAPI_KEY"];

const server = new McpServer({
  name: "dropship-detector",
  version: "0.1.0",
});

server.tool(
  "analyze_store",
  "Run the full dropshipping detection agent on a store or product URL. Returns a verdict with score, evidence, and reasoning.",
  { url: z.string().url().describe("Store or product URL to analyze") },
  async ({ url }) => {
    const result = await runScan(url, {
      groqApiKey: groqKey,
      serpApiKey: serpKey,
      maxSerpCalls: undefined,
      onStep: undefined,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              score: result.verdict.score,
              label: result.verdict.label,
              confidence: result.verdict.confidence,
              reasoning: result.verdict.reasoning,
              evidence: result.verdict.evidence,
              supplierMatches: result.supplierMatches,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "get_store_fingerprint",
  "Analyze a store page for platform detection (Shopify/WooCommerce), dropship app traces (DSers/Oberlo/Zendrop), and contact info presence.",
  { url: z.string().url().describe("Store URL to fingerprint") },
  async ({ url }) => {
    const result = await getStoreFingerprint(url);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "check_domain_age",
  "Look up domain registration date via RDAP. Returns age in days and registrar info.",
  { url: z.string().url().describe("URL whose domain to check") },
  async ({ url }) => {
    const result = await getDomainAge(url);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "check_shipping_policy",
  "Fetch shipping/return pages and extract delivery estimates and red flags like long delivery windows or mentions of overseas warehouses.",
  { url: z.string().url().describe("Store URL to check shipping policy for") },
  async ({ url }) => {
    const result = await checkShippingPolicy(url);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "find_supplier_matches",
  "Search for the supplier/wholesale listing of a product using reverse image search and AliExpress title search. Returns matches with prices.",
  { url: z.string().url().describe("Product page URL to find supplier for") },
  async ({ url }) => {
    if (!serpKey) {
      return {
        content: [
          { type: "text", text: "Error: SERPAPI_KEY not configured" },
        ],
      };
    }
    const matches = await findSupplierMatches(url, serpKey);
    return {
      content: [{ type: "text", text: JSON.stringify(matches, null, 2) }],
    };
  }
);

server.tool(
  "find_cheaper_source",
  "Find the verified supplier source for a product with price comparison. The most useful tool for consumers — shows you where to buy the same item cheaper.",
  { url: z.string().url().describe("Product page URL") },
  async ({ url }) => {
    if (!serpKey) {
      return {
        content: [{ type: "text", text: "Error: SERPAPI_KEY not configured" }],
      };
    }
    const matches = await findSupplierMatches(url, serpKey);
    const verified = matches.filter(
      (m) => m.matchConfidence === "exact" || m.matchConfidence === "likely_same"
    );

    if (verified.length === 0) {
      return {
        content: [{ type: "text", text: "No verified supplier matches found." }],
      };
    }

    const lines = verified.map((m) => {
      const price = m.price !== undefined ? `$${m.price.toFixed(2)}` : "unknown price";
      const markup =
        m.markupMultiplier !== undefined ? ` (${m.markupMultiplier}x markup)` : "";
      return `${m.marketplace}: ${price}${markup}\n  ${m.url}`;
    });

    return {
      content: [
        {
          type: "text",
          text: `Found ${verified.length} supplier match(es):\n\n${lines.join("\n\n")}`,
        },
      ],
    };
  }
);

server.tool(
  "compare_prices",
  "Search a product title on Google Shopping and return price distribution across stores.",
  {
    product_title: z.string().describe("Product title to search"),
    store_price: z
      .number()
      .optional()
      .describe("Current store price for markup comparison"),
  },
  async ({ product_title, store_price }) => {
    if (!serpKey) {
      return {
        content: [{ type: "text", text: "Error: SERPAPI_KEY not configured" }],
      };
    }
    const results = await googleShoppingSearch(product_title, serpKey);
    const marketplaceResults = results.filter((r) => r.isMarketplace);

    let text = `Found ${results.length} Google Shopping results.\n`;
    if (marketplaceResults.length > 0) {
      const prices = marketplaceResults.map((r) => r.price);
      const min = Math.min(...prices);
      text += `\nLowest marketplace price: $${min.toFixed(2)}`;
      if (store_price) {
        const markup = (store_price / min).toFixed(1);
        text += ` (${markup}x store markup)`;
      }
      text += "\n\nMarketplace listings:\n";
      for (const r of marketplaceResults.slice(0, 5)) {
        text += `  • $${r.price.toFixed(2)} on ${r.source}: ${r.url}\n`;
      }
    }

    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "check_shipping_policy",
  "Fetch and analyze the shipping/returns policy page for delivery time red flags.",
  { url: z.string().url().describe("Store URL") },
  async ({ url }) => {
    const result = await checkShippingPolicy(url);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Dropship Detector MCP server running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
