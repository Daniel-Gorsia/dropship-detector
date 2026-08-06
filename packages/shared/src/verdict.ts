import { z } from "zod";

export const EvidenceItem = z.object({
  signal: z.string(),
  finding: z.string(),
  direction: z.enum(["dropship", "legit", "neutral"]),
  weight: z.enum(["weak", "moderate", "strong"]),
  sourceUrl: z.string().url().optional(),
});

export const Verdict = z.object({
  score: z.number().min(0).max(100),
  label: z.enum(["unlikely", "possible", "likely", "almost_certain"]),
  confidence: z.enum(["low", "medium", "high"]),
  evidence: z.array(EvidenceItem),
  reasoning: z.string(),
});

export const SupplierMatch = z.object({
  marketplace: z.string(),
  url: z.string().url(),
  price: z.number().optional(),
  currency: z.string().default("USD"),
  matchConfidence: z.enum(["exact", "likely_same", "similar_product"]),
  markupMultiplier: z.number().optional(),
  imageUrl: z.string().url().optional(),
});

export const ScanStatus = z.enum([
  "pending",
  "running",
  "complete",
  "error",
]);

export const Scan = z.object({
  id: z.string(),
  url: z.string().url(),
  normalizedUrl: z.string(),
  status: ScanStatus,
  verdict: Verdict.nullable(),
  supplierMatches: z.array(SupplierMatch).default([]),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});

export const AgentStep = z.object({
  type: z.enum([
    "tool_call",
    "tool_result",
    "reasoning",
    "verdict",
    "error",
  ]),
  tool: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  message: z.string().optional(),
  timestamp: z.string().datetime(),
});

export type EvidenceItem = z.infer<typeof EvidenceItem>;
export type Verdict = z.infer<typeof Verdict>;
export type SupplierMatch = z.infer<typeof SupplierMatch>;
export type ScanStatus = z.infer<typeof ScanStatus>;
export type Scan = z.infer<typeof Scan>;
export type AgentStep = z.infer<typeof AgentStep>;
