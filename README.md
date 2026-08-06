# Dropship Detector

Paste a product or store URL → an AI agent investigates → verdict: *"83% likely dropshipped"* with evidence breakdown and a link to the same item on AliExpress for $4.

## What it does

The agent runs a multi-step investigation:

1. **Fingerprints the store** — Shopify platform, dropship app markers (DSers/Oberlo/Zendrop), missing contact info
2. **Checks domain age** — fresh domains (<6 months) are suspicious
3. **Reads the shipping policy** — "7–20 business days" and overseas warehouse mentions are red flags
4. **Searches for the supplier listing** — reverse-image-searches the product photo on Google Lens to find it on AliExpress/Alibaba/Temu
5. **Compares prices** — quantifies the markup (e.g. "8.3x — sold for $3.80 on AliExpress")

Results are framed as likelihood estimates, not accusations.

## Quickstart

```bash
# Install
pnpm install

# Copy env vars
cp .env.example .env
# Fill in GROQ_API_KEY (required) and SERPAPI_KEY (for image search)

# Build shared package first
pnpm --filter @dropship/shared build
pnpm --filter @dropship/core build

# CLI — free signals only (no API keys needed)
ANTHROPIC_API_KEY=... node apps/api/dist... # or:
cd packages/core && pnpm build
node dist/cli.js https://example-store.com/products/item

# CLI — full agent scan
node dist/cli.js https://example-store.com/products/item --full

# Start API + web dev servers
pnpm dev
# API: http://localhost:3001
# Web: http://localhost:5173
```

## MCP Server

Expose the detection tools to Claude Desktop / Claude Code:

```bash
pnpm --filter @dropship/mcp build

# Add to claude_desktop_config.json or .claude/settings.json:
{
  "mcpServers": {
    "dropship-detector": {
      "command": "node",
      "args": ["/path/to/dropship-detector/apps/mcp/dist/index.js"],
      "env": {
        "GROQ_API_KEY": "gsk_...",
        "SERPAPI_KEY": "..."
      }
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `analyze_store` | Full agent scan — returns verdict + evidence |
| `get_store_fingerprint` | Platform + dropship app detection |
| `check_domain_age` | RDAP domain registration lookup |
| `check_shipping_policy` | Delivery estimates + red flags |
| `find_supplier_matches` | Reverse-image search for supplier listing |
| `find_cheaper_source` | "Here's the same item for $4" — the killer feature |
| `compare_prices` | Google Shopping price distribution |

## Architecture

```
dropship-detector/
├── apps/
│   ├── web/        # React + Vite + Tailwind (Vercel)
│   ├── api/        # Express + SSE streaming (Vercel/Render)
│   └── mcp/        # MCP server (stdio)
├── packages/
│   ├── core/       # Detection engine + agent loop
│   └── shared/     # Zod schemas + types
```

All detection logic lives in `packages/core`. The Express API and MCP server are thin wrappers.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Yes | Powers the agent (Llama 3.3 70B) — get one at console.groq.com |
| `SERPAPI_KEY` | No | Enables reverse image search + price comparison (100/mo free) |
| `DATABASE_URL` | For API | Neon Postgres connection string |

## Hosting

- **Frontend**: Vercel (static Vite build)
- **API**: Vercel Functions or Render (free tier)
- **DB**: Neon Postgres (free tier, 0.5 GB)

## Disclaimer

Results are probabilistic likelihood estimates based on automated signals. This tool does not make definitive claims about any store's business practices.

## License

MIT
