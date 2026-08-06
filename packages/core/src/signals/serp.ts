import { fetchJson } from "../fetch.js";

export interface ImageSearchResult {
  url: string;
  title: string;
  domain: string;
  thumbnail: string | undefined;
  price: number | undefined;
  isMarketplace: boolean;
}

export interface PriceSearchResult {
  title: string;
  price: number;
  url: string;
  source: string;
  isMarketplace: boolean;
}

const MARKETPLACE_DOMAINS = [
  "aliexpress.com",
  "alibaba.com",
  "temu.com",
  "wish.com",
  "dhgate.com",
  "shein.com",
  "banggood.com",
  "gearbest.com",
  "1688.com",
];

function isMarketplaceDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return MARKETPLACE_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    );
  } catch {
    return false;
  }
}

async function serpApiGet<T>(
  endpoint: string,
  params: Record<string, string>,
  apiKey: string
): Promise<T> {
  const url = new URL(`https://serpapi.com/${endpoint}`);
  url.searchParams.set("api_key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return fetchJson<T>(url.toString());
}

export async function reverseImageSearch(
  imageUrl: string,
  apiKey: string
): Promise<ImageSearchResult[]> {
  const data = await serpApiGet<{
    image_results?: Array<{
      link?: string;
      title?: string;
      thumbnail?: string;
    }>;
  }>(
    "search",
    {
      engine: "google_reverse_image",
      image_url: imageUrl,
      gl: "us",
      hl: "en",
    },
    apiKey
  );

  return (data.image_results ?? []).map((r) => {
    const url = r.link ?? "";
    let domain = "";
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      // ignore
    }
    return {
      url,
      title: r.title ?? "",
      domain,
      thumbnail: r.thumbnail ?? undefined,
      price: undefined,
      isMarketplace: isMarketplaceDomain(url),
    };
  });
}

export async function searchByText(
  query: string,
  apiKey: string
): Promise<Array<{ url: string; title: string; snippet: string }>> {
  const data = await serpApiGet<{
    organic_results?: Array<{
      link?: string;
      title?: string;
      snippet?: string;
    }>;
  }>(
    "search",
    { engine: "google", q: query, gl: "us", hl: "en" },
    apiKey
  );

  return (data.organic_results ?? []).map((r) => ({
    url: r.link ?? "",
    title: r.title ?? "",
    snippet: r.snippet ?? "",
  }));
}

export async function googleShoppingSearch(
  query: string,
  apiKey: string
): Promise<PriceSearchResult[]> {
  const data = await serpApiGet<{
    shopping_results?: Array<{
      title?: string;
      price?: string;
      link?: string;
      source?: string;
    }>;
  }>(
    "search",
    { engine: "google_shopping", q: query, gl: "us" },
    apiKey
  );

  return (data.shopping_results ?? [])
    .map((r) => {
      const rawPrice = r.price ?? "";
      const price = parseFloat(rawPrice.replace(/[^0-9.]/g, ""));
      const url = r.link ?? "";
      return {
        title: r.title ?? "",
        price: isNaN(price) ? 0 : price,
        url,
        source: r.source ?? "",
        isMarketplace: isMarketplaceDomain(url),
      };
    })
    .filter((r) => r.price > 0);
}

export { isMarketplaceDomain, MARKETPLACE_DOMAINS };
