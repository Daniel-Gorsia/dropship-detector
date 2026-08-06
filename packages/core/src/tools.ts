import type Groq from "groq-sdk";

export const TOOL_DEFINITIONS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_store_fingerprint",
      description:
        "Fetch the store HTML and detect platform (Shopify/WooCommerce), dropship app traces (DSers, Oberlo, Zendrop), and presence of contact info. Free signal — always run first.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Store or product URL to fingerprint" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_domain_age",
      description:
        "Look up domain registration date via RDAP. Domains under 6 months old are suspicious. Free signal.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL whose domain to check" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_shipping_policy",
      description:
        "Fetch shipping/policy pages and extract delivery estimates. Long windows (15+ days) or mentions of Chinese warehouses are red flags. Free signal.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Store URL to check shipping policy for" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_description_plagiarism",
      description:
        "Take a distinctive sentence from the product description and Google-search it exactly. Many stores sharing identical copy = supplier catalog text. Costs 1 SerpAPI credit.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Product page URL" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_supplier_matches",
      description:
        "Reverse-image-search the product photo and title-search AliExpress to find the likely supplier listing. Returns matches with prices — 5x+ markup is a strong signal. Costs 1-2 SerpAPI credits.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Product page URL" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_prices",
      description:
        "Search the product title on Google Shopping to compare price across stores. Costs 1 SerpAPI credit.",
      parameters: {
        type: "object",
        properties: {
          product_title: { type: "string", description: "Product title to search" },
          store_price: {
            type: "number",
            description: "Current store's asking price for comparison",
          },
        },
        required: ["product_title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_verdict",
      description:
        "Submit the final verdict. Call this once you have enough evidence to make a calibrated assessment.",
      parameters: {
        type: "object",
        properties: {
          score: {
            type: "number",
            description: "Dropship likelihood 0-100",
          },
          label: {
            type: "string",
            enum: ["unlikely", "possible", "likely", "almost_certain"],
            description: "Categorical label",
          },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "Confidence in the verdict",
          },
          evidence: {
            type: "array",
            description: "List of evidence items",
            items: {
              type: "object",
              properties: {
                signal: { type: "string" },
                finding: { type: "string" },
                direction: {
                  type: "string",
                  enum: ["dropship", "legit", "neutral"],
                },
                weight: {
                  type: "string",
                  enum: ["weak", "moderate", "strong"],
                },
                sourceUrl: { type: "string" },
              },
              required: ["signal", "finding", "direction", "weight"],
            },
          },
          reasoning: {
            type: "string",
            description: "Plain-English explanation of the verdict",
          },
        },
        required: ["score", "label", "confidence", "evidence", "reasoning"],
      },
    },
  },
];
