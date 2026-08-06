import express, { type Express } from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { scanRouter } from "./routes/scan.js";
import { telegramRouter } from "./routes/telegram.js";

const app: Express = express();
const PORT = parseInt(process.env["PORT"] ?? "3001", 10);

app.use(cors({ origin: process.env["CORS_ORIGIN"] ?? "http://localhost:5173" }));
app.use(express.json());

// Rate limit all API routes — protect SerpAPI credits
app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
  })
);

app.use("/api/scan", scanRouter);

// Separate, lighter rate limit for history (read-only)
app.use(
  "/api/history",
  rateLimit({ windowMs: 60 * 1000, max: 60 }),
  async (_req, res) => {
    res.redirect(307, "/api/scan");
  }
);

// Telegram webhook — no rate limit (Telegram handles its own throttling)
app.use("/telegram", telegramRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

export default app;
