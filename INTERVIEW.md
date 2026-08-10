# Dropship Detector — Interview Guide

---

## One-sentence pitch
> "I built an AI agent that analyzes any e-commerce store URL and determines whether it's a dropshipping operation — with a 0–100 likelihood score, itemised evidence, and a confidence level. It streams the investigation live to the browser so the user watches the agent think."

---

## What it does (30 seconds)
- User pastes a product or store URL in the web app or Telegram bot
- An AI agent (Llama 3.3 70B via Groq) runs multiple investigation tools — checking the store platform, domain age (RDAP), shipping policy, and optionally reverse-image-searching for the supplier listing
- Returns a verdict: **score 0–100**, categorical label, confidence level, and an itemised evidence list with direction and weight per signal
- The investigation streams live to the browser over SSE — the user watches each step appear in real time

---

## Architecture (know this well)

```
apps/web     React + Vite + Tailwind      SSE consumer, renders live timeline
apps/api     Express + SSE + Drizzle      POST /scan → stream → persist
apps/mcp     MCP stdio server             exposes same tools to Claude Desktop/Code
packages/core  Detection engine           agent loop + 5 signal detectors + SerpAPI
packages/shared  Zod schemas + types      Verdict, EvidenceItem, AgentStep, Scan
```

**The key design decision worth saying first:**
> "All detection logic lives in `packages/core`. The Express API, Telegram bot, and MCP server are thin wrappers around the same engine. That's why the same code ships as a web app, a CLI, and an MCP server with zero logic duplication."

---

## The seven tools

| Tool | Cost | What it does |
|------|------|-------------|
| `get_store_fingerprint` | free | platform + dropship app detection + contact info |
| `check_domain_age` | free | RDAP lookup via IANA bootstrap |
| `check_shipping_policy` | free | tries 12 policy URLs, regex for red flags |
| `check_description_plagiarism` | 1 SerpAPI credit | exact-phrase Google search |
| `find_supplier_matches` | 1–2 credits | reverse image search → AliExpress/Temu |
| `compare_prices` | 1 credit | Google Shopping price distribution |
| `submit_verdict` | free | terminal tool — how the agent finishes |

`submit_verdict` is a deliberate pattern: using a tool call as structured output rather than parsing free text. Worth calling out explicitly.

---

## The agent loop

Built with **Vercel AI SDK** (`ai` + `@ai-sdk/groq`) — provider-agnostic:

```ts
await generateText({
  model: groq("llama-3.3-70b-versatile"),
  tools,           // each tool has Zod schema + execute function
  maxSteps: 10,    // safety ceiling, not a meaningful number
  onStepFinish: ({ toolCalls, toolResults }) => {
    // emit to SSE stream → browser renders each step live
  }
});
```

**Why `maxSteps: 10`?** It's a guard against infinite loops, not a meaningful choice. A scan uses 4–7 steps in practice. 6 tools × ~1.5 rounds = ~9, rounded up.

**Why Vercel AI SDK?** Switching providers is now one line:
```ts
// from Groq to Anthropic:
import { anthropic } from "@ai-sdk/anthropic";
const model = anthropic("claude-3-5-haiku");
// everything else unchanged
```

**SDK handles the loop automatically** — tool `execute` functions run when the model calls them, results feed back to the model, loop repeats until `submit_verdict` or `maxSteps`. No manual message history management.

**Parallel tool calls** — the SDK runs independent tools concurrently. The first three free signals fire in parallel, cutting latency by ~3×.

---

## Technical highlights to mention

| Topic | What to say |
|-------|-------------|
| **Vercel AI SDK** | Provider-agnostic agent loop — swap Groq for Anthropic/OpenAI in one line |
| **SSE streaming** | Server pushes each agent step live — user watches the investigation in real time |
| **RDAP + IANA bootstrap** | Finds the correct RDAP server per TLD instead of hardcoding one |
| **Shopify detection** | Hits `/products.json` and inspects HTTP response headers, not just HTML |
| **Monorepo** | pnpm workspaces — shared Zod types consumed by API, web, MCP, CLI |
| **DB cache** | Normalized URL cached for 24h — repeat scans are instant and free |
| **In-memory fallback** | Dev works without Neon — `store.ts` detects missing DATABASE_URL |
| **Webhook security** | Telegram webhook uses a random secret in the URL path as a password |

---

## Database & Caching

**Database:** Neon Postgres (serverless — scales to zero when idle, free tier)
**ORM:** Drizzle — lightweight, TypeScript-first, faster cold-start than Prisma
**Why Postgres over MySQL:** JSONB support for flexible `verdict` and `steps` columns

**Two cache layers:**

1. **Scan cache (implemented)** — if the same normalized URL was scanned in the last 24h, return the cached result immediately. No LLM call, no SerpAPI credits.

2. **Signal cache (schema exists, not yet wired)** — `signal_cache` table for caching RDAP/SerpAPI results per domain. Not connected yet.

**Normalized URL** — strips query params, trailing slashes, and case differences so `?utm_source=tiktok` and the clean URL hit the same cache entry.

---

## Problems you solved

- **Node 18 + undici conflict** — `cheerio@1.2.0` pulled in undici 7.x which requires Node 20. Fixed by pinning cheerio to `1.0.0`.
- **Groq tool call failure** — overly long system prompt confused Llama's function call format. Fixed by compressing to a concise scoring rubric.
- **RDAP failures** — hardcoded `rdap.org` failed silently for many TLDs. Fixed with IANA bootstrap lookup (`data.iana.org/rdap/dns.json`).
- **Render + pnpm monorepo** — Render defaulted to npm, breaking `workspace:*` references. Fixed by removing `rootDir` so `pnpm-lock.yaml` is at the repo root.
- **Provider refactor** — replaced `groq-sdk` with Vercel AI SDK for provider independence. The 150-line manual agent loop collapsed to `generateText` with `maxSteps`.

---

## Known weaknesses (say these before they ask)

> Naming your own weaknesses first is the strongest move available.

1. **LLM does the scoring arithmetic** — the system prompt gives weights (+30 for DSers, −15 for Wix) but the model adds them up in its head. LLMs are unreliable at arithmetic. Fix: pure `computeScore(signals)` function in code; LLM only orchestrates and writes the explanation.

2. **No runtime Zod validation on the verdict** — `finalVerdict = args` is trusted from the model. The Zod schema exists but isn't used at runtime. Fix: `Verdict.safeParse(args)` and feed errors back as tool results so the model can self-correct.

3. **No tests** — zero test coverage. The code is shaped for it (pure signal functions over HTML strings), just not written yet. First move: split fetch from analysis in each signal, then unit-test the pure functions with saved HTML fixtures.

4. **No temperature set** — runs at provider default (~1.0). For a scoring system, `temperature: 0` is clearly right. Makes output non-deterministic and harder to eval.

5. **No wall-clock deadline** — `checkShippingPolicy` tries 12 URLs sequentially at up to 15s each. One tool call can take minutes. Fix: `AbortSignal` with a timeout threaded through every fetch.

6. **Silent failure fallback** — if the agent fails to call `submit_verdict`, a fabricated `{ score: 50, label: "possible" }` is returned. Nothing tells the user this happened.

7. **Prompt injection** — scraped page text reaches the model's context. A store owner can embed hidden instructions in white-on-white HTML to manipulate the verdict.

---

## Stack (one line each)

- **Groq + Vercel AI SDK** — fast inference, free tier, provider-agnostic agent loop
- **SerpAPI** — Google Lens reverse image search + Google Shopping (100/mo free)
- **Neon** — serverless Postgres, free tier, autosuspends when idle
- **Drizzle ORM** — lightweight TypeScript ORM, faster cold-start than Prisma/TypeORM
- **Render** — API (Web Service) + frontend (Static Site), both free tier
- **Telegram Bot API** — webhook-based bot, plain URLs work without `/scan` prefix

---

## What to emphasize per role

**Frontend** → Live SSE streaming UI, React state machine (idle/scanning/done/error), glass morphism design system with Tailwind, animated SVG score gauge, `fade-in-up` staggered step animations

**Backend** → Agent loop with Vercel AI SDK, SSE streaming with DB polling, in-memory store fallback for dev, rate limiting, Telegram webhook with secret-in-URL auth, normalized URL cache

**Full-stack** → Monorepo design, shared Zod schemas across all packages, `packages/core` as the single source of truth for detection logic

**AI/ML** → Vercel AI SDK for provider independence, `submit_verdict` as structured output pattern, cheap-before-expensive escalation, signal weighting rubric, known calibration weaknesses

---

## Note on the detailed interview-prep doc

The external prep document references old line numbers from before the Vercel AI SDK refactor. Key things that changed:

| Finding in doc | Status after refactor |
|----------------|-----------------------|
| Finding #7 — tools run serially | ✅ **Fixed** — Vercel AI SDK runs parallel tool calls automatically |
| Finding #14 — provider lock-in (`Groq.Chat.ChatCompletionMessageParam[]`) | ✅ **Fixed** — Vercel AI SDK is provider-agnostic |
| All `agent.ts` line references | ❌ **Stale** — file was rewritten, line numbers changed |
| Finding #1 — LLM does arithmetic | Still true |
| Finding #2 — no Zod validation at runtime | Still true |
| Finding #3 — no wall-clock deadline | Still true |
| Finding #6 — silent failure fallback | Still true |
| Finding #15 — prompt injection | Still true |

---

## One thing that makes it stand out

> "Most dropshipping detectors give a binary yes/no. This one shows you *why* — every signal is an evidence item with direction, weight, and source URL. The agent investigates live in front of you. And the whole architecture is designed so the same engine runs as a web app, a Telegram bot, and an MCP server in Claude Desktop."
