const BASE = import.meta.env["VITE_API_URL"] ?? "/api";

export async function startScan(url: string): Promise<{ id: string; cached: boolean }> {
  const res = await fetch(`${BASE}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ id: string; cached: boolean }>;
}

export async function getScan(id: string): Promise<unknown> {
  const res = await fetch(`${BASE}/scan/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function streamScan(
  id: string,
  onEvent: (data: unknown) => void,
  onClose: () => void
): () => void {
  const es = new EventSource(`${BASE}/scan/${id}/stream`);
  es.onmessage = (e) => {
    try {
      const data: unknown = JSON.parse(e.data as string);
      onEvent(data);
    } catch {
      // ignore malformed
    }
  };
  es.onerror = () => {
    es.close();
    onClose();
  };
  return () => es.close();
}

export async function getHistory(): Promise<unknown[]> {
  const res = await fetch(`${BASE}/scan`);
  if (!res.ok) return [];
  return res.json() as Promise<unknown[]>;
}
