import { Router, type Router as RouterType } from "express";
import { getStore } from "../store.js";

export const telegramRouter: RouterType = Router();

const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"] ?? "";
const API_BASE_URL = process.env["API_BASE_URL"] ?? "http://localhost:3001";

async function sendMessage(chatId: number, text: string, parseMode?: "Markdown" | "HTML") {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }),
  });
}

function formatVerdict(url: string, verdict: Record<string, unknown>, supplierMatches: unknown[]): string {
  const score = verdict["score"] as number;
  const label = String(verdict["label"]).replace("_", " ");
  const confidence = verdict["confidence"] as string;
  const reasoning = verdict["reasoning"] as string;

  const emoji =
    score >= 76 ? "🚨" :
    score >= 51 ? "⚠️" :
    score >= 26 ? "🟡" : "✅";

  const matches = supplierMatches as Array<Record<string, unknown>>;
  const matchLines = matches
    .filter((m) => m["matchConfidence"] !== "similar_product")
    .slice(0, 2)
    .map((m) => {
      const price = m["price"] ? `$${m["price"]}` : "unknown price";
      const markup = m["markupMultiplier"] ? ` (${m["markupMultiplier"]}× markup)` : "";
      return `  • ${m["marketplace"]}: ${price}${markup}\n    ${m["url"]}`;
    })
    .join("\n");

  let text = `${emoji} *Dropship Analysis*\n\n`;
  text += `🔗 ${url}\n`;
  text += `📊 Score: *${score}/100* — ${label}\n`;
  text += `🎯 Confidence: ${confidence}\n\n`;
  text += `${reasoning}\n`;

  if (matchLines) {
    text += `\n💰 *Cheaper source found:*\n${matchLines}\n`;
  }

  return text;
}

async function runScanAndNotify(chatId: number, url: string) {
  // Start scan
  let scanId: string;
  try {
    const res = await fetch(`${API_BASE_URL}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json() as { id: string; cached: boolean };
    scanId = data.id;

    if (data.cached) {
      await sendMessage(chatId, `♻️ Using cached result for this URL…`);
    }
  } catch {
    await sendMessage(chatId, "❌ Failed to start scan. Is the server running?");
    return;
  }

  // Poll until complete (max 2 minutes)
  const store = await getStore();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const scan = await store.getById(scanId);
    if (!scan) break;

    if (scan.status === "complete" && scan.verdict) {
      const text = formatVerdict(
        url,
        scan.verdict as Record<string, unknown>,
        (scan.supplierMatches as unknown[]) ?? []
      );
      await sendMessage(chatId, text, "Markdown");
      return;
    }

    if (scan.status === "error") {
      const err = (scan.verdict as Record<string, unknown>)?.["error"] ?? "Unknown error";
      await sendMessage(chatId, `❌ Scan failed: ${err}`);
      return;
    }
  }

  await sendMessage(chatId, "⏱️ Scan timed out. Try again in a moment.");
}

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
    from?: { first_name?: string };
  };
}

// POST /telegram/:secret — Telegram calls this for every update
telegramRouter.post("/:secret", (req, res) => {
  const secret = process.env["TELEGRAM_WEBHOOK_SECRET"] ?? "";
  if (req.params["secret"] !== secret || !secret) {
    res.sendStatus(403);
    return;
  }

  // Always ack Telegram immediately — must respond within 5s
  res.sendStatus(200);

  const update = req.body as TelegramUpdate;
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const text = msg.text?.trim() ?? "";

  if (text === "/start" || text === "/help") {
    void sendMessage(
      chatId,
      `👋 *Dropship Detector Bot*\n\nSend me a product or store URL to check if it's a dropshipping operation.\n\n*Commands:*\n/scan <url> — Analyze a store\n/help — Show this message\n\n*Example:*\n/scan https://some-store.com/products/item`,
      "Markdown"
    );
    return;
  }

  if (text.startsWith("/scan ")) {
    const url = text.replace("/scan ", "").trim();

    try {
      new URL(url);
    } catch {
      void sendMessage(chatId, "❌ That doesn't look like a valid URL. Try:\n/scan https://example-store.com/products/item");
      return;
    }

    void sendMessage(chatId, `🔍 Scanning *${url}*…\n\nThis takes 20–60 seconds.`, "Markdown");
    void runScanAndNotify(chatId, url);
    return;
  }

  // Plain URL without /scan command
  if (text.startsWith("http://") || text.startsWith("https://")) {
    void sendMessage(chatId, `🔍 Scanning *${text}*…\n\nThis takes 20–60 seconds.`, "Markdown");
    void runScanAndNotify(chatId, text);
    return;
  }

  void sendMessage(chatId, "Send me a URL to scan, or use /help for instructions.");
});
