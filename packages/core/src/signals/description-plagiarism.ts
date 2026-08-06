import * as cheerio from "cheerio";
import { fetchHtml } from "../fetch.js";
import { searchByText } from "./serp.js";

export interface PlagiarismResult {
  sampleSentence: string;
  matchCount: number;
  matchingDomains: string[];
  isPlagiarized: boolean;
}

function extractDistinctiveSentence(html: string): string | null {
  const $ = cheerio.load(html);

  // Try product description areas first
  const descSelectors = [
    ".product-description",
    ".description",
    '[class*="description"]',
    ".product__description",
    ".product-single__description",
    "#product-description",
  ];

  for (const sel of descSelectors) {
    const el = $(sel).first();
    if (el.length) {
      const text = el.text().trim();
      const sentences = text.match(/[^.!?]+[.!?]/g) ?? [];
      const distinctive = sentences.find(
        (s) => s.length > 40 && s.length < 200 && !/copyright|rights reserved/i.test(s)
      );
      if (distinctive) return distinctive.trim();
    }
  }

  return null;
}

export async function checkDescriptionPlagiarism(
  url: string,
  apiKey: string
): Promise<PlagiarismResult> {
  let html = "";
  try {
    html = await fetchHtml(url);
  } catch {
    return {
      sampleSentence: "",
      matchCount: 0,
      matchingDomains: [],
      isPlagiarized: false,
    };
  }

  const sentence = extractDistinctiveSentence(html);
  if (!sentence) {
    return {
      sampleSentence: "",
      matchCount: 0,
      matchingDomains: [],
      isPlagiarized: false,
    };
  }

  const query = `"${sentence.substring(0, 120)}"`;
  const results = await searchByText(query, apiKey);

  const matchingDomains = results
    .map((r) => {
      try {
        return new URL(r.url).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  return {
    sampleSentence: sentence,
    matchCount: results.length,
    matchingDomains: [...new Set(matchingDomains)],
    isPlagiarized: results.length >= 3,
  };
}
