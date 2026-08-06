const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
};

export async function fetchHtml(url: string, timeoutMs = 15_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: DEFAULT_HEADERS,
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T = unknown>(url: string, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { ...DEFAULT_HEADERS, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return `${u.protocol}//${u.hostname}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return raw;
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
