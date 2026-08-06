import { eq, desc } from "drizzle-orm";

export interface ScanRow {
  id: string;
  url: string;
  normalizedUrl: string;
  status: string;
  verdict: unknown;
  supplierMatches: unknown[];
  steps: unknown[];
  createdAt: Date;
  completedAt: Date | null;
}

// ── In-memory store (used when DATABASE_URL is not configured) ───────────────

const mem = new Map<string, ScanRow>();

const memStore = {
  async insert(row: ScanRow) {
    mem.set(row.id, { ...row });
  },
  async getById(id: string): Promise<ScanRow | null> {
    return mem.get(id) ?? null;
  },
  async getByNormalizedUrl(url: string): Promise<ScanRow | null> {
    return [...mem.values()].find((r) => r.normalizedUrl === url) ?? null;
  },
  async update(id: string, updates: Partial<ScanRow>) {
    const row = mem.get(id);
    if (row) mem.set(id, { ...row, ...updates });
  },
  async getRecent(limit: number): Promise<ScanRow[]> {
    return [...mem.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  },
};

// ── DB store (used when DATABASE_URL is configured) ──────────────────────────

async function makeDbStore() {
  const { db, schema } = await import("./db/index.js");

  return {
    async insert(row: ScanRow) {
      await db.insert(schema.scans).values({
        id: row.id,
        url: row.url,
        normalizedUrl: row.normalizedUrl,
        status: row.status,
        verdict: row.verdict as Record<string, unknown> | null,
        supplierMatches: row.supplierMatches as unknown[],
        steps: row.steps as unknown[],
      });
    },
    async getById(id: string): Promise<ScanRow | null> {
      const rows = await db
        .select()
        .from(schema.scans)
        .where(eq(schema.scans.id, id))
        .limit(1);
      return toRow(rows[0]) ?? null;
    },
    async getByNormalizedUrl(url: string): Promise<ScanRow | null> {
      const rows = await db
        .select()
        .from(schema.scans)
        .where(eq(schema.scans.normalizedUrl, url))
        .limit(1);
      return toRow(rows[0]) ?? null;
    },
    async update(id: string, updates: Partial<ScanRow>) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patch: any = {};
      if (updates.status !== undefined) patch.status = updates.status;
      if (updates.verdict !== undefined) patch.verdict = updates.verdict;
      if (updates.supplierMatches !== undefined) patch.supplierMatches = updates.supplierMatches;
      if (updates.steps !== undefined) patch.steps = updates.steps;
      if (updates.completedAt !== undefined) patch.completedAt = updates.completedAt;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await db.update(schema.scans).set(patch).where(eq(schema.scans.id, id));
    },
    async getRecent(limit: number): Promise<ScanRow[]> {
      const rows = await db
        .select()
        .from(schema.scans)
        .orderBy(desc(schema.scans.createdAt))
        .limit(limit);
      return rows.map(toRow).filter((r): r is ScanRow => r !== null);
    },
  };
}

function toRow(row: Record<string, unknown> | undefined): ScanRow | null {
  if (!row) return null;
  return {
    id: String(row["id"]),
    url: String(row["url"]),
    normalizedUrl: String(row["normalizedUrl"]),
    status: String(row["status"]),
    verdict: row["verdict"] ?? null,
    supplierMatches: (row["supplierMatches"] as unknown[]) ?? [],
    steps: (row["steps"] as unknown[]) ?? [],
    createdAt: row["createdAt"] instanceof Date ? row["createdAt"] : new Date(String(row["createdAt"])),
    completedAt:
      row["completedAt"] instanceof Date
        ? row["completedAt"]
        : row["completedAt"]
        ? new Date(String(row["completedAt"]))
        : null,
  };
}

// ── Export the right store ───────────────────────────────────────────────────

const dbUrl = process.env["DATABASE_URL"] ?? "";
const hasRealDb = dbUrl.length > 0 && !dbUrl.includes("user:pass@host");

export type Store = Awaited<ReturnType<typeof makeDbStore>>;

let _store: Store | null = null;

export async function getStore(): Promise<Store> {
  if (_store) return _store;
  if (hasRealDb) {
    _store = await makeDbStore();
  } else {
    console.log("[store] No DATABASE_URL — using in-memory store");
    _store = memStore;
  }
  return _store;
}
