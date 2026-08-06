import * as cheerio from "cheerio";
import { fetchJson, extractDomain } from "../fetch.js";

export interface FingerprintResult {
  platform: string | null;
  platformConfidence: "confirmed" | "likely" | "unknown";
  dropshipApps: string[];
  hasAddress: boolean;
  hasPhone: boolean;
  hasAboutPage: boolean;
  hasReturnPolicy: boolean;
  genericTheme: boolean;
  suspiciousIndicators: string[];
  legitimacySignals: string[];
}

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

async function fetchWithHeaders(url: string): Promise<{ html: string; headers: Record<string, string> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return { html, headers };
  } finally {
    clearTimeout(timer);
  }
}

const DROPSHIP_APP_MARKERS = [
  { name: "DSers",          patterns: [/dsers/i, /dsers-aliexpress/i] },
  { name: "Oberlo",         patterns: [/oberlo/i] },
  { name: "Zendrop",        patterns: [/zendrop/i] },
  { name: "AutoDS",         patterns: [/autods/i] },
  { name: "Spocket",        patterns: [/spocket/i] },
  { name: "Modalyst",       patterns: [/modalyst/i] },
  { name: "CJDropshipping", patterns: [/cjdropshipping/i] },
  { name: "Dropified",      patterns: [/dropified/i] },
  { name: "Importify",      patterns: [/importify/i] },
  { name: "Eprolo",         patterns: [/eprolo/i] },
  { name: "Trendsi",        patterns: [/trendsi/i] },
];

// Strong Shopify indicators (any one = confirmed)
const SHOPIFY_STRONG = [
  /cdn\.shopify\.com/,
  /myshopify\.com/,
  /window\.Shopify\s*=/,
  /ShopifyAnalytics/,
  /Shopify\.shop\s*=/,
  /"shop_id"\s*:/,
  /shopify-payment-button/,
  /__shopify_chunk_/,
];

// Weaker Shopify indicators (need 2+ to count)
const SHOPIFY_WEAK = [
  /Shopify\.theme/i,
  /shopify_pay/i,
  /route-shopify/i,
  /shopify\.com\/s\/files/i,
];

const WOOCOMMERCE_MARKERS = [/woocommerce/i, /wp-content\/plugins\/woocommerce/i];
const BIGCOMMERCE_MARKERS = [/bigcommerce/i, /cdn\.bigcommerce\.com/i];
const SQUARESPACE_MARKERS = [/squarespace/i, /static\.squarespace\.com/i];
const WIX_MARKERS = [/wix\.com/i, /static\.parastorage\.com/i];
const WEEBLY_MARKERS = [/weebly/i, /editmysite\.com/i];

export async function getStoreFingerprint(url: string): Promise<FingerprintResult> {
  const domain = extractDomain(url);
  const storeRoot = `https://${domain}`;

  let html = "";
  let responseHeaders: Record<string, string> = {};

  // Fetch the page
  try {
    const result = await fetchWithHeaders(url);
    html = result.html;
    responseHeaders = result.headers;
  } catch {
    // try store root if product page fails
    try {
      const result = await fetchWithHeaders(storeRoot);
      html = result.html;
      responseHeaders = result.headers;
    } catch { /* give up */ }
  }

  // Also fetch store root if we got a product page, to get homepage signals
  let rootHtml = "";
  if (url !== storeRoot && !url.endsWith("/")) {
    try {
      const result = await fetchWithHeaders(storeRoot);
      rootHtml = result.html;
    } catch { /* ignore */ }
  }

  const combinedHtml = html + " " + rootHtml;
  const $ = cheerio.load(combinedHtml);
  const scriptText = $("script").text();
  const fullText = combinedHtml + " " + scriptText;

  // ── Platform detection ────────────────────────────────────────────────────

  let platform: string | null = null;
  let platformConfidence: "confirmed" | "likely" | "unknown" = "unknown";

  // 1. Response headers (most reliable)
  const serverHeader = responseHeaders["server"] ?? "";
  const viaHeader = responseHeaders["via"] ?? "";
  const xShopifyStage = responseHeaders["x-shopify-stage"] ?? responseHeaders["x-shopid"] ?? "";
  const xSortingHat = responseHeaders["x-sorting-hat-shopid"] ?? "";

  if (xShopifyStage || xSortingHat || /shopify/i.test(serverHeader)) {
    platform = "Shopify";
    platformConfidence = "confirmed";
  }

  // 2. Shopify products.json endpoint (definitive)
  if (!platform) {
    try {
      const productData = await fetchJson<Record<string, unknown>>(
        `${storeRoot}/products.json?limit=1`
      );
      if (productData["products"] !== undefined) {
        platform = "Shopify";
        platformConfidence = "confirmed";
      }
    } catch { /* not Shopify */ }
  }

  // 3. HTML markers
  if (!platform) {
    if (SHOPIFY_STRONG.some((p) => p.test(fullText))) {
      platform = "Shopify";
      platformConfidence = "confirmed";
    } else if (SHOPIFY_WEAK.filter((p) => p.test(fullText)).length >= 2) {
      platform = "Shopify";
      platformConfidence = "likely";
    } else if (WOOCOMMERCE_MARKERS.some((p) => p.test(fullText))) {
      platform = "WooCommerce";
      platformConfidence = "confirmed";
    } else if (BIGCOMMERCE_MARKERS.some((p) => p.test(fullText))) {
      platform = "BigCommerce";
      platformConfidence = "confirmed";
    } else if (SQUARESPACE_MARKERS.some((p) => p.test(fullText))) {
      platform = "Squarespace";
      platformConfidence = "confirmed";
    } else if (WIX_MARKERS.some((p) => p.test(fullText))) {
      platform = "Wix";
      platformConfidence = "confirmed";
    } else if (WEEBLY_MARKERS.some((p) => p.test(fullText))) {
      platform = "Weebly";
      platformConfidence = "confirmed";
    }
  }

  // ── Dropship app detection ────────────────────────────────────────────────

  const dropshipApps = DROPSHIP_APP_MARKERS
    .filter((app) => app.patterns.some((p) => p.test(fullText)))
    .map((app) => app.name);

  // ── Contact & policy signals ──────────────────────────────────────────────

  const bodyText = $("body").text().toLowerCase();

  const hasAddress = /\d+\s+\w[\w\s]+\s+(st|street|ave|avenue|rd|road|blvd|boulevard|drive|dr|lane|ln|way|court|ct|pl|place)\b/i.test(bodyText);
  const hasPhone = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}|\+\d{1,3}[-.\s]\d{4,}/.test(bodyText);

  const hasAboutPage =
    $('a[href*="/about"]').length > 0 ||
    $('a[href*="about-us"]').length > 0 ||
    $('a[href*="about_us"]').length > 0 ||
    $('a[href*="our-story"]').length > 0 ||
    $('a[href*="who-we-are"]').length > 0;

  const hasReturnPolicy =
    $('a[href*="return"]').length > 0 ||
    $('a[href*="refund"]').length > 0 ||
    /return\s+policy|refund\s+policy/i.test(bodyText);

  // Generic Shopify theme — commonly used by dropshippers
  const genericTheme = /\b(dawn|debut|supply|brooklyn|narrative|boundless|minimal|simple|venture)\b/i.test(fullText);

  // ── Red flags & legitimacy signals ───────────────────────────────────────

  const suspiciousIndicators: string[] = [];
  const legitimacySignals: string[] = [];

  if (dropshipApps.length > 0) {
    suspiciousIndicators.push(`Dropship apps detected: ${dropshipApps.join(", ")}`);
  }
  if (!hasAddress && !hasPhone) {
    suspiciousIndicators.push("No physical address or phone number found");
  }
  if (!hasAboutPage) {
    suspiciousIndicators.push("No about/our-story page in navigation");
  }
  if (genericTheme && platform === "Shopify") {
    suspiciousIndicators.push("Uses a generic free Shopify theme common among dropshippers");
  }
  if (/free.{0,10}shipping/i.test(fullText) && /worldwide|international/i.test(fullText)) {
    suspiciousIndicators.push("Advertises free worldwide shipping (common dropship marketing)");
  }
  if (/buy\s+\d+\s+get\s+\d+|flash\s+sale|limited\s+time|today\s+only/i.test(bodyText)) {
    suspiciousIndicators.push("High-pressure sales tactics common in dropshipping stores");
  }

  if (hasAddress) legitimacySignals.push("Has physical address");
  if (hasPhone) legitimacySignals.push("Has phone number");
  if (hasAboutPage) legitimacySignals.push("Has about page");
  if (hasReturnPolicy) legitimacySignals.push("Has return/refund policy page");
  if (["Squarespace", "Wix", "Weebly"].includes(platform ?? "")) {
    legitimacySignals.push(`Built on ${platform} (less common for dropshipping)`);
  }
  if (platform === "WooCommerce") {
    legitimacySignals.push("WordPress/WooCommerce store (often owner-operated)");
  }

  return {
    platform,
    platformConfidence,
    dropshipApps,
    hasAddress,
    hasPhone,
    hasAboutPage,
    hasReturnPolicy,
    genericTheme,
    suspiciousIndicators,
    legitimacySignals,
  };
}
