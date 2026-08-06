import * as cheerio from "cheerio";
import { fetchHtml, extractDomain } from "../fetch.js";

export interface ShippingResult {
  shippingPageUrl: string | null;
  deliveryEstimates: string[];
  redFlags: string[];
  hasLongShipping: boolean;
  mentionsChina: boolean;
  mentionsWarehouse: boolean;
  fulfillmentLocation: string | null;
}

const LONG_SHIPPING_PATTERNS = [
  /\b(1[5-9]|[2-9]\d)\s*[-–to]+\s*\d+\s*(business\s+)?days?\b/i,
  /\b[2-9]\s*[-–to]+\s*\d+\s*weeks?\b/i,
  /\b[1-9]\s*[-–to]+\s*\d+\s*months?\b/i,
  /processing\s+time[^\n]{0,40}(7|8|9|10|1[0-9])\s*[-–]\s*\d+/i,
  /ships?\s+within\s+(2|3|4|5)\s*weeks?/i,
];

const DELIVERY_ESTIMATE_PATTERNS = [
  /\d+\s*[-–]\s*\d+\s*(business\s+)?days?/gi,
  /\d+\s*to\s*\d+\s*(business\s+)?days?/gi,
  /\d+\s*[-–]\s*\d+\s*weeks?/gi,
];

const CHINA_PATTERNS = [
  /\bchina\b/i,
  /\bchinese\s+warehouse\b/i,
  /shipped\s+from\s+(china|asia|hong\s*kong)/i,
  /\bhong\s*kong\b/i,
  /\bshenzhen\b/i,
  /\bguangzhou\b/i,
];

const WAREHOUSE_PATTERNS = [
  /international\s+warehouse/i,
  /overseas\s+warehouse/i,
  /fulfillment\s+center\s+(?:in|from)\s+(?:asia|china|abroad)/i,
  /multiple\s+warehouses?\s+(?:globally|worldwide|internationally)/i,
  /our\s+warehouse\s+(?:is\s+located\s+)?(?:in\s+)?(?:china|asia)/i,
];

const DROPSHIP_SHIPPING_PHRASES = [
  { pattern: /7[-–]\s*20\s*(business\s+)?days?/i, flag: "Classic AliExpress window: '7-20 business days'" },
  { pattern: /7[-–]\s*15\s*(business\s+)?days?/i, flag: "Typical dropship window: '7-15 business days'" },
  { pattern: /10[-–]\s*30\s*(business\s+)?days?/i, flag: "Long shipping window: '10-30 business days'" },
  { pattern: /due\s+to\s+(high\s+demand|covid|pandemic)/i, flag: "Uses 'high demand' excuse for slow shipping" },
  { pattern: /tracking\s+(?:may\s+take|takes?)\s+(3|4|5|6|7)\s*[-–]\s*\d+\s*(business\s+)?days?\s+to\s+update/i, flag: "Slow tracking updates typical of overseas shipments" },
  { pattern: /package\s+(?:may\s+)?(?:take|takes?)\s+longer\s+(?:than\s+expected|to\s+arrive)/i, flag: "Vague delay disclaimer" },
  { pattern: /\baliexpress\b/i, flag: "Directly mentions AliExpress" },
  { pattern: /\bsupplier\b.{0,60}\bship/i, flag: "Mentions supplier shipping" },
];

async function tryFetchPage(url: string): Promise<string | null> {
  try {
    const html = await fetchHtml(url);
    if (html.length > 300 && /ship|deliver|dispatch|transit|return|refund/i.test(html)) {
      return html;
    }
    return null;
  } catch {
    return null;
  }
}

export async function checkShippingPolicy(url: string): Promise<ShippingResult> {
  const domain = extractDomain(url);
  const base = `https://${domain}`;

  const pagePaths = [
    "/pages/shipping-policy",
    "/pages/shipping",
    "/shipping-policy",
    "/shipping",
    "/pages/delivery",
    "/delivery",
    "/pages/returns",
    "/pages/refund-policy",
    "/refund-policy",
    "/returns",
    "/policies/shipping-policy",
    "/policies/refund-policy",
  ];

  let shippingPageUrl: string | null = null;
  let html = "";

  for (const path of pagePaths) {
    const fetched = await tryFetchPage(`${base}${path}`);
    if (fetched) {
      html = fetched;
      shippingPageUrl = `${base}${path}`;
      break;
    }
  }

  // Fall back to the input URL itself
  if (!html) {
    try {
      html = await fetchHtml(url);
    } catch {
      return {
        shippingPageUrl: null,
        deliveryEstimates: [],
        redFlags: [],
        hasLongShipping: false,
        mentionsChina: false,
        mentionsWarehouse: false,
        fulfillmentLocation: null,
      };
    }
  }

  const $ = cheerio.load(html);
  const text = $("body").text();

  const deliveryEstimates: string[] = [];
  for (const pattern of DELIVERY_ESTIMATE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) deliveryEstimates.push(...matches);
  }

  const hasLongShipping = LONG_SHIPPING_PATTERNS.some((p) => p.test(text));
  const mentionsChina = CHINA_PATTERNS.some((p) => p.test(text));
  const mentionsWarehouse = WAREHOUSE_PATTERNS.some((p) => p.test(text));

  // Detect fulfillment location
  let fulfillmentLocation: string | null = null;
  const locMatch = text.match(
    /(?:ship(?:ped|s|ping)|fulfill(?:ment|ed|s)?|dispatched?)\s+from\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/
  );
  if (locMatch?.[1]) fulfillmentLocation = locMatch[1];

  const redFlags: string[] = [];

  if (hasLongShipping) {
    redFlags.push("Long shipping times (15+ business days) typical of overseas drop-shipping");
  }
  if (mentionsChina) {
    redFlags.push("Mentions shipping from China/Hong Kong/Shenzhen");
  }
  if (mentionsWarehouse) {
    redFlags.push("References international/overseas warehouse");
  }
  for (const { pattern, flag } of DROPSHIP_SHIPPING_PHRASES) {
    if (pattern.test(text)) {
      redFlags.push(flag);
    }
  }
  if (fulfillmentLocation && /china|hong kong|shenzhen|guangzhou|asia/i.test(fulfillmentLocation)) {
    redFlags.push(`Ships from ${fulfillmentLocation}`);
  }

  return {
    shippingPageUrl,
    deliveryEstimates: [...new Set(deliveryEstimates)].slice(0, 5),
    redFlags: [...new Set(redFlags)],
    hasLongShipping,
    mentionsChina,
    mentionsWarehouse,
    fulfillmentLocation,
  };
}
