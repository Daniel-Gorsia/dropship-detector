import { Router, type Router as RouterType } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { runScan, normalizeUrl } from "@dropship/core";
import type { AgentStep } from "@dropship/shared";
import { getStore } from "../store.js";

export const scanRouter: RouterType = Router();

const StartScanBody = z.object({
  url: z.string().url(),
});

// POST /api/scan
scanRouter.post("/", async (req, res) => {
  const parsed = StartScanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { url } = parsed.data;
  const normalizedUrl = normalizeUrl(url);
  const store = await getStore();

  // Return cached result if <24h old
  const cached = await store.getByNormalizedUrl(normalizedUrl);
  if (
    cached &&
    cached.status === "complete" &&
    Date.now() - cached.createdAt.getTime() < 24 * 60 * 60 * 1000
  ) {
    res.json({ id: cached.id, cached: true });
    return;
  }

  const id = randomUUID();
  await store.insert({
    id,
    url,
    normalizedUrl,
    status: "pending",
    verdict: null,
    supplierMatches: [],
    steps: [],
    createdAt: new Date(),
    completedAt: null,
  });

  void startScanJob(id, url);

  res.json({ id, cached: false });
});

async function startScanJob(id: string, url: string) {
  const store = await getStore();
  await store.update(id, { status: "running" });

  try {
    const steps: AgentStep[] = [];
    const result = await runScan(url, {
      groqApiKey: process.env["GROQ_API_KEY"] ?? "",
      serpApiKey: process.env["SERPAPI_KEY"],
      maxSerpCalls: undefined,
      onStep: (step) => {
        steps.push(step);
        void store.update(id, { steps: [...steps] });
      },
    });

    await store.update(id, {
      status: "complete",
      verdict: result.verdict,
      supplierMatches: result.supplierMatches,
      steps,
      completedAt: new Date(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.update(id, {
      status: "error",
      verdict: { error: message },
      completedAt: new Date(),
    });
  }
}

// GET /api/scan/:id
scanRouter.get("/:id", async (req, res) => {
  const store = await getStore();
  const scan = await store.getById(req.params["id"] ?? "");
  if (!scan) {
    res.status(404).json({ error: "Scan not found" });
    return;
  }
  res.json(scan);
});

// GET /api/scan/:id/stream  — SSE
scanRouter.get("/:id/stream", async (req, res) => {
  const scanId = req.params["id"] ?? "";
  const store = await getStore();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let lastStepCount = 0;

  const poll = async () => {
    const scan = await store.getById(scanId);
    if (!scan) {
      res.write(`data: ${JSON.stringify({ type: "error", message: "Scan not found" })}\n\n`);
      res.end();
      clearInterval(intervalId);
      return;
    }

    const steps = (scan.steps as AgentStep[]) ?? [];
    for (const step of steps.slice(lastStepCount)) {
      res.write(`data: ${JSON.stringify(step)}\n\n`);
    }
    lastStepCount = steps.length;

    if (scan.status === "complete" || scan.status === "error") {
      res.write(
        `data: ${JSON.stringify({ type: "done", status: scan.status, verdict: scan.verdict })}\n\n`
      );
      res.end();
      clearInterval(intervalId);
    }
  };

  const intervalId = setInterval(() => void poll(), 1000);
  void poll();
  req.on("close", () => clearInterval(intervalId));
});

// GET /api/scan  — history
scanRouter.get("/", async (_req, res) => {
  const store = await getStore();
  const rows = await store.getRecent(20);
  res.json(
    rows.map((r) => ({
      id: r.id,
      url: r.url,
      status: r.status,
      verdict: r.verdict,
      createdAt: r.createdAt,
    }))
  );
});
