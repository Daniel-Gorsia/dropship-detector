# Dropship Detector — Architecture & Agent Loop

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                               │
│                                                                     │
│   ┌─────────────────────┐          ┌──────────────────────┐        │
│   │   Web App           │          │   Telegram Bot       │        │
│   │   React + Vite      │          │   (any chat client)  │        │
│   │   Render Static     │          │                      │        │
│   └────────┬────────────┘          └──────────┬───────────┘        │
│            │ HTTPS                             │ HTTPS              │
└────────────┼─────────────────────────────────-┼────────────────────┘
             │                                   │
             ▼                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          API LAYER                                  │
│                   Express — Render Web Service                      │
│                                                                     │
│   POST /api/scan          → start scan, return id                  │
│   GET  /api/scan/:id      → get result                             │
│   GET  /api/scan/:id/stream → SSE stream of agent steps            │
│   GET  /api/scan          → scan history                           │
│   POST /telegram/:secret  → Telegram webhook                       │
│                                                                     │
│   ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐    │
│   │  Rate Limit  │   │  In-memory   │   │  Neon Postgres     │    │
│   │  (per IP)    │   │  Store (dev) │   │  (production)      │    │
│   └──────────────┘   └──────────────┘   └────────────────────┘    │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        CORE PACKAGE                                 │
│                  packages/core — shared engine                      │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │                    AGENT LOOP                               │  │
│   │              Vercel AI SDK + Groq                           │  │
│   │           (Llama 3.3 70B via tool use)                      │  │
│   │                                                             │  │
│   │   ┌────────────┐  ┌────────────┐  ┌─────────────────────┐  │  │
│   │   │ Fingerprint│  │ Domain Age │  │  Shipping Policy    │  │  │
│   │   │  (free)    │  │  (free)    │  │  (free)             │  │  │
│   │   └────────────┘  └────────────┘  └─────────────────────┘  │  │
│   │   ┌────────────┐  ┌────────────┐  ┌─────────────────────┐  │  │
│   │   │Description │  │  Supplier  │  │  Price Compare      │  │  │
│   │   │Plagiarism  │  │  Matches   │  │  (SerpAPI)          │  │  │
│   │   │ (SerpAPI)  │  │ (SerpAPI)  │  │                     │  │  │
│   │   └────────────┘  └────────────┘  └─────────────────────┘  │  │
│   │                                                             │  │
│   │                  submit_verdict ──▶ Verdict JSON            │  │
│   └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
             │                    │                    │
             ▼                    ▼                    ▼
     ┌──────────────┐   ┌──────────────────┐   ┌──────────────┐
     │  RDAP.org /  │   │   Groq API       │   │  SerpAPI     │
     │  IANA RDAP   │   │  (Llama 3.3 70B) │   │  (optional)  │
     │  (domain age)│   │                  │   │              │
     └──────────────┘   └──────────────────┘   └──────────────┘
```

---

## Request Flow — Web App

```
User pastes URL
      │
      ▼
POST /api/scan
      │
      ├──▶ Check cache (same URL scanned < 24h?) ──▶ return cached id
      │
      ├──▶ Insert scan row (status: pending)
      │
      ├──▶ Return { id } immediately  ◀── user gets id in ~100ms
      │
      └──▶ void startScanJob(id, url)  ← fire and forget (async)
                    │
                    ▼
            Agent loop runs in background
                    │
                    ├── each tool call ──▶ store.update(steps[])
                    │
                    └── done ──▶ store.update(verdict, status: complete)

Meanwhile, browser opens:
GET /api/scan/:id/stream  (SSE connection stays open)
      │
      └── polls store every 1s
              │
              ├── new steps? ──▶ write to SSE stream ──▶ browser renders step
              │
              └── status=complete? ──▶ send { type: done } ──▶ close stream
```

---

## Request Flow — Telegram Bot

```
User sends message to bot
         │
         ▼
Telegram servers
         │  POST (webhook)
         ▼
POST /telegram/:secret
         │
         ├──▶ Respond 200 immediately  ◀── must reply within 5s
         │
         ├──▶ sendMessage("🔍 Scanning…")
         │
         └──▶ runScanAndNotify(chatId, url)  ← async
                       │
                       ├── POST /api/scan  ──▶ get id
                       │
                       ├── poll store every 3s (max 2 min)
                       │
                       └── scan complete ──▶ sendMessage(verdict)
```

---

## Monorepo Structure

```
dropship-detector/
│
├── packages/
│   ├── shared/          ← Zod schemas (Verdict, Scan, AgentStep)
│   │                      used by ALL other packages
│   │
│   └── core/            ← Detection engine
│       ├── agent.ts        main agent loop (Vercel AI SDK)
│       ├── fetch.ts        HTTP utilities
│       ├── source-finder.ts  supplier match logic
│       └── signals/
│           ├── fingerprint.ts    platform + dropship app detection
│           ├── domain-age.ts     RDAP lookup with IANA bootstrap
│           ├── shipping.ts       shipping policy analysis
│           ├── description-plagiarism.ts  exact-phrase search
│           └── serp.ts           SerpAPI (image search, shopping)
│
└── apps/
    ├── web/             ← React + Vite + Tailwind (frontend)
    ├── api/             ← Express + Drizzle (backend)
    └── mcp/             ← MCP server (Claude Desktop integration)
```

---

## Agent Loop — Code Walkthrough

The agent loop is in `packages/core/src/agent.ts`. Here is how it works step by step:

### 1. Setup

```ts
const groq = createGroq({ apiKey: config.groqApiKey });
```

Creates a Groq client via the Vercel AI SDK. To switch to a different model,
this is the only line that needs to change:

```ts
// Switch to Anthropic:
const anthropic = createAnthropic({ apiKey: config.anthropicApiKey });

// Switch to OpenAI:
const openai = createOpenAI({ apiKey: config.openaiApiKey });
```

Everything else — tools, system prompt, agent loop — stays identical.

---

### 2. Tools with execute functions

Each tool has two parts:
- `parameters` — Zod schema that tells the LLM what arguments to pass
- `execute` — the actual function that runs when the LLM calls the tool

```ts
get_store_fingerprint: tool({
  description: "Fetch the store HTML and detect platform...",
  parameters: z.object({ url: z.string().url() }),
  execute: async ({ url }) => getStoreFingerprint(url),  // ← runs our signal
}),
```

The LLM never sees the execute function — it only sees the description and
parameters. The SDK calls execute automatically and feeds the result back
to the LLM as the tool response.

---

### 3. The loop itself

```ts
await generateText({
  model: groq("llama-3.3-70b-versatile"),
  system: SYSTEM_PROMPT,
  prompt: `Analyze this URL: ${url}`,
  tools,
  maxSteps: 10,      // ← safety limit, not a meaningful number
  onStepFinish: ...  // ← emit SSE steps
});
```

`maxSteps: 10` means the loop can run at most 10 rounds. In practice a scan
uses 4–7 steps. The number was chosen as: 6 tools × ~1.5 rounds average = ~9,
rounded up to 10 as a safe ceiling.

**What happens inside each step:**
```
Step 1:  LLM decides to call get_store_fingerprint, check_domain_age,
         check_shipping_policy (all at once — SDK runs them in parallel)

Step 2:  LLM receives results, decides whether to escalate

Step 3:  If signals are weak → calls check_description_plagiarism
                             or find_supplier_matches

Step N:  LLM calls submit_verdict → loop ends
```

---

### 4. Cheap before expensive

The system prompt instructs the LLM to run free signals first:

```
STEP 1 - Run all three free signals first (no API cost)
STEP 2 - If signals are ambiguous, escalate to SerpAPI tools
STEP 3 - Call submit_verdict
```

The SerpAPI budget guard in each paid tool enforces this in code:

```ts
execute: async ({ url }) => {
  if (!config.serpApiKey) return { error: "SerpAPI key not configured" };
  if (serpCallsUsed >= maxSerpCalls) return { error: "SerpAPI budget exhausted" };
  serpCallsUsed++;
  return checkDescriptionPlagiarism(url, config.serpApiKey);
},
```

So even if the LLM tries to call paid tools too many times, the budget cap
stops it at the code level.

---

### 5. Verdict capture

`submit_verdict` is just another tool, but its execute function captures
the result into a closure variable:

```ts
submit_verdict: tool({
  parameters: z.object({ score, label, confidence, evidence, reasoning }),
  execute: async (args) => {
    finalVerdict = args;   // ← captured here
    return { ok: true };   // ← LLM sees this and stops
  },
}),
```

After `generateText` resolves, `finalVerdict` holds the structured result.

---

### 6. SSE streaming

`onStepFinish` fires after every round and emits each tool call and result
to the SSE stream so the browser updates in real time:

```ts
onStepFinish: ({ text, toolCalls, toolResults }) => {
  for (const tc of toolCalls)    emit({ type: "tool_call", ... });
  for (const tr of toolResults)  emit({ type: "tool_result", ... });
}
```

The browser receives these events and renders each step as it happens —
that is the live agent timeline in the UI.
