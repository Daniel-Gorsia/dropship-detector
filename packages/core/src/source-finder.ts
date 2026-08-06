import * as cheerio from "cheerio";
import type { SupplierMatch } from "@dropship/shared";
import { fetchHtml } from "./fetch.js";
import {
  reverseImageSearch,
  searchByText,
  isMarketplaceDomain,
} from "./signals/serp.js";

function extractProductImages(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const images: string[] = [];

  // Shopify product images
  $("img").each((_, el) => {
    const src =
      $(el).attr("data-src") ??
      $(el).attr("data-original") ??
      $(el).attr("src") ??
      "";
    if (src && /product|item|feat/i.test(src)) {
      try {
        images.push(new URL(src, baseUrl).href);
      } catch {
        // ignore
      }
    }
  });

  return [...new Set(images)].slice(0, 3);
}

function extractStorePrice(html: string): number | null {
  const $ = cheerio.load(html);
  const priceEl = $(
    '[class*="price"]:not([class*="compare"]):not([class*="original"])'
  ).first();
  const text = priceEl.text();
  const match = text.match(/[\$€£]?\s*(\d+(?:[.,]\d{2})?)/);
  if (!match?.[1]) return null;
  return parseFloat(match[1].replace(",", "."));
}

function extractProductTitle(html: string): string {
  const $ = cheerio.load(html);
  return (
    $("h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content") ||
    ""
  );
}

export async function findSupplierMatches(
  productUrl: string,
  serpApiKey: string
): Promise<SupplierMatch[]> {
  let html = "";
  try {
    html = await fetchHtml(productUrl);
  } catch {
    return [];
  }

  const storePrice = extractStorePrice(html);
  const productTitle = extractProductTitle(html);
  const images = extractProductImages(html, productUrl);
  const matches: SupplierMatch[] = [];

  // Strategy 1: reverse image search on product photos
  for (const imageUrl of images.slice(0, 2)) {
    try {
      const results = await reverseImageSearch(imageUrl, serpApiKey);
      const marketplaceHits = results.filter((r) => r.isMarketplace);
      for (const hit of marketplaceHits.slice(0, 3)) {
        let price: number | undefined;
        // Try to parse price from title
        const priceMatch = hit.title.match(/[\$€£]?\s*(\d+(?:\.\d{2})?)/);
        if (priceMatch?.[1]) price = parseFloat(priceMatch[1]);

        const markup =
          storePrice && price && price > 0
            ? Math.round((storePrice / price) * 10) / 10
            : undefined;

        matches.push({
          marketplace: hit.domain,
          url: hit.url,
          price,
          currency: "USD",
          matchConfidence: "likely_same",
          markupMultiplier: markup,
          imageUrl: hit.thumbnail,
        });
      }
    } catch {
      // continue to next image
    }
  }

  // Strategy 2: title search on AliExpress
  if (productTitle && matches.length < 2) {
    try {
      const query = `site:aliexpress.com ${productTitle.slice(0, 60)}`;
      const results = await searchByText(query, serpApiKey);
      for (const r of results.slice(0, 2)) {
        if (isMarketplaceDomain(r.url)) {
          const priceMatch = r.snippet.match(/\$\s*(\d+(?:\.\d{2})?)/);
          const price = priceMatch?.[1]
            ? parseFloat(priceMatch[1])
            : undefined;
          const markup =
            storePrice && price && price > 0
              ? Math.round((storePrice / price) * 10) / 10
              : undefined;

          matches.push({
            marketplace: "aliexpress.com",
            url: r.url,
            price,
            currency: "USD",
            matchConfidence: "similar_product",
            markupMultiplier: markup,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  return matches;
}
