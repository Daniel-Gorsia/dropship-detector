# Dropship Detector — Interview Guide

---

## One-sentence pitch
> "I built an AI agent that analyzes any e-commerce store URL and tells you whether it's a dropshipping operation — with evidence, a confidence score, and a confidence level."

---

## What it does (30 seconds)
- User pastes a product or store URL
- An AI agent runs multiple investigation tools in sequence — checking the store's platform, domain age, shipping policy, and searching for the supplier listing
- Returns a verdict: **score 0–100**, evidence breakdown, and a confidence level
- Works via a **web app** and a **Telegram bot**

---

## Architecture (know this well)

```
Web (React + Vite)  ──▶  API (Express + SSE)  ──▶  Detection Core
Telegram Bot        ──▶  same API              ──▶  same Core
MCP Server          ──▶  same Core
```

**Key design decision:** All detection logic lives in `packages/core`. The Express API and Telegram bot are just thin wrappers around the same engine. This is a monorepo with pnpm workspaces.

---

## The agent loop (most interesting part)
The core uses **Groq (Llama 3.3 70B)** with tool use — the LLM decides which signals to run and in what order:

1. **Cheap pass first** — store fingerprint, domain age (RDAP), shipping policy — all free
2. **Reason** — if signals are weak, escalate
3. **Expensive pass** — reverse image search, AliExpress title search, price comparison (SerpAPI credits)
4. **Verdict** — structured JSON with score, label, confidence, evidence array

The LLM orchestrates the investigation, not a hardcoded script.

---

## Technical highlights to mention

| Topic | What to say |
|-------|-------------|
| **Streaming** | The API streams agent steps live via SSE — the user watches the AI think in real time |
| **Tool use** | LLM decides which tools to call, in what order, based on what it finds |
| **RDAP** | Used IANA bootstrap to find the correct RDAP server per TLD instead of hardcoding one |
| **Shopify detection** | Hits `/products.json` and inspects HTTP response headers, not just HTML |
| **Monorepo** | pnpm workspaces — shared types/schemas in one package, consumed by API, web, MCP, CLI |
| **Zod schemas** | Verdict shape is validated with Zod on both ends |
| **MCP server** | Exposes the same tools to Claude Desktop/Code as an MCP server |

---

## Problems you solved
- **Node 18 + undici conflict** — `cheerio@1.2.0` pulled in undici 7.x which requires Node 20. Fixed by pinning cheerio to 1.0.0.
- **Groq tool call failure** — overly long system prompt confused Llama's function call formatting. Fixed by compressing it to a concise scoring rubric.
- **RDAP failures** — hardcoded `rdap.org` silently failed for many TLDs. Fixed with IANA bootstrap lookup.
- **Render + pnpm monorepo** — Render defaulted to npm which broke `workspace:*` references. Fixed by removing `rootDir` so Render sees `pnpm-lock.yaml` at the repo root.

---

## Stack (one line each)
- **Groq** — fast inference, free tier, Llama 3.3 70B for tool use
- **SerpAPI** — Google Lens reverse image search + Google Shopping
- **Neon** — serverless Postgres, free tier
- **Drizzle ORM** — lightweight TypeScript ORM
- **Render** — deployed API (Web Service) + frontend (Static Site)
- **Telegram Bot API** — webhook-based bot, responds to plain URLs

---

## What to emphasize per role

**Frontend role** → Live SSE streaming UI, React state machine for scan phases, glass morphism design system, score gauge SVG animation

**Backend role** → Agent loop architecture, SSE streaming, in-memory store fallback for dev, rate limiting, webhook security with secret token

**Full-stack role** → Monorepo design, shared Zod schemas across frontend/backend, the decision to keep all logic in `packages/core`

**AI/ML role** → Prompt engineering for tool use, cheap-first escalation strategy, signal weighting system, why Groq over OpenAI/Gemini

---

## One thing that makes it stand out
> "Most dropshipping detectors just say yes or no. This one shows you *why* — every signal is an evidence item with direction, weight, and source. That's the detail that makes people trust the result."
