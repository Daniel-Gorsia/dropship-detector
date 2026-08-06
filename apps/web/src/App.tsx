import { useState, useEffect, useRef } from "react";
import type { Verdict, AgentStep, SupplierMatch } from "@dropship/shared";
import { startScan, getScan, streamScan } from "./api.js";
import { AgentTimeline } from "./components/AgentTimeline.js";
import { VerdictCard } from "./components/VerdictCard.js";
import { History } from "./components/History.js";

type AppState =
  | { phase: "idle" }
  | { phase: "scanning"; scanId: string; steps: AgentStep[]; url: string }
  | { phase: "done"; verdict: Verdict; supplierMatches: SupplierMatch[]; steps: AgentStep[]; url: string }
  | { phase: "error"; message: string; url: string };

const FEATURES = [
  { icon: "🏪", label: "Store fingerprint", desc: "Detects Shopify, DSers, Oberlo, Zendrop traces" },
  { icon: "📅", label: "Domain age",        desc: "New domains (<6 months) are a red flag" },
  { icon: "🚢", label: "Shipping policy",   desc: "15+ day windows = overseas fulfilment" },
  { icon: "🔍", label: "Supplier match",    desc: "Finds the same product cheaper on AliExpress" },
];

export function App() {
  const [inputUrl, setInputUrl] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("url") ?? "";
  });
  const [state, setState] = useState<AppState>({ phase: "idle" });
  const [showHistory, setShowHistory] = useState(false);
  const stopStream = useRef<(() => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url = params.get("url");
    if (url) void handleScan(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleScan(rawUrl?: string) {
    const url = rawUrl ?? inputUrl;
    if (!url.trim()) return;

    stopStream.current?.();
    setState({ phase: "scanning", scanId: "", steps: [], url });
    setShowHistory(false);

    try {
      const { id } = await startScan(url);
      setState((prev) => (prev.phase === "scanning" ? { ...prev, scanId: id } : prev));

      stopStream.current = streamScan(
        id,
        (data) => {
          const evt = data as Record<string, unknown>;
          if (evt["type"] === "done") {
            void getScan(id).then((scan) => {
              const s = scan as Record<string, unknown>;
              if (s["status"] === "complete" && s["verdict"]) {
                setState({
                  phase: "done",
                  verdict: s["verdict"] as Verdict,
                  supplierMatches: (s["supplierMatches"] as SupplierMatch[]) ?? [],
                  steps: (s["steps"] as AgentStep[]) ?? [],
                  url,
                });
              } else if (s["status"] === "error") {
                const err = (s["verdict"] as Record<string, unknown>)?.["error"];
                setState({ phase: "error", message: String(err ?? "Unknown error"), url });
              }
            });
          } else {
            setState((prev) =>
              prev.phase === "scanning"
                ? { ...prev, steps: [...prev.steps, evt as unknown as AgentStep] }
                : prev
            );
          }
        },
        () => {
          void getScan(id).then((scan) => {
            const s = scan as Record<string, unknown>;
            if (s["status"] === "complete" && s["verdict"]) {
              setState({
                phase: "done",
                verdict: s["verdict"] as Verdict,
                supplierMatches: (s["supplierMatches"] as SupplierMatch[]) ?? [],
                steps: (s["steps"] as AgentStep[]) ?? [],
                url,
              });
            }
          });
        }
      );
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
        url,
      });
    }
  }

  function handleReset() {
    stopStream.current?.();
    setState({ phase: "idle" });
    setInputUrl("");
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  const isScanning = state.phase === "scanning";

  return (
    <div className="min-h-screen flex flex-col">

      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-white/5 backdrop-blur-xl bg-[#050510]/80">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={handleReset} className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-lg bg-brand-500/20 border border-brand-500/30 flex items-center justify-center text-sm group-hover:bg-brand-500/30 transition-colors">
              🔍
            </div>
            <span className="font-semibold text-slate-200 text-lg tracking-tight">Dropship Detector</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all ${
                showHistory
                  ? "glass text-slate-200 border-white/15"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              History
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-10 space-y-8">

        {/* Hero / search */}
        <div className={`text-center space-y-6 transition-all duration-500 ${state.phase !== "idle" ? "pt-0" : "pt-6"}`}>
          {state.phase === "idle" && (
            <div className="space-y-3 fade-in-up">
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight gradient-text leading-tight">
                Is this store<br />dropshipping?
              </h1>
              <p className="text-slate-400 text-base max-w-md mx-auto leading-relaxed">
                Paste any product or store URL. Our AI agent investigates in seconds and shows you the evidence.
              </p>
            </div>
          )}

          {/* Search form */}
          <form
            onSubmit={(e) => { e.preventDefault(); void handleScan(); }}
            className="relative"
          >
            <div className={`relative flex gap-2 transition-all duration-300 ${
              state.phase !== "idle" ? "" : "shadow-[0_0_40px_rgba(99,102,241,0.1)]"
            }`}>
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  type="url"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="https://some-store.com/products/item"
                  disabled={isScanning}
                  className="w-full px-4 py-3.5 pr-10 rounded-xl glass border-white/10 focus:border-brand-500/50 focus:outline-none focus:ring-2 focus:ring-brand-500/20 placeholder-slate-600 text-slate-100 text-sm disabled:opacity-50 transition-all"
                />
                {inputUrl && !isScanning && (
                  <button
                    type="button"
                    onClick={() => setInputUrl("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={isScanning || !inputUrl.trim()}
                className="px-5 py-3.5 rounded-xl font-semibold text-sm bg-brand-500 hover:bg-brand-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 text-white shrink-0 flex items-center gap-2"
              >
                {isScanning ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Scanning
                  </>
                ) : (
                  <>
                    Analyze
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Feature pills — idle only */}
          {state.phase === "idle" && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 fade-in-up" style={{ animationDelay: "150ms" }}>
              {FEATURES.map((f) => (
                <div key={f.label} className="glass rounded-xl p-3 text-left group hover:border-white/15 transition-colors cursor-default">
                  <div className="text-xl mb-1.5">{f.icon}</div>
                  <p className="text-xs font-semibold text-slate-300">{f.label}</p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-snug">{f.desc}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* History panel */}
        {showHistory && (
          <History
            onSelect={(url) => { setInputUrl(url); void handleScan(url); }}
            onClose={() => setShowHistory(false)}
          />
        )}

        {/* Scanning */}
        {state.phase === "scanning" && (
          <div className="glass rounded-2xl p-6 space-y-4 fade-in-up">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-brand-400 animate-ping" />
              <span className="text-sm text-slate-400 truncate">Analyzing <span className="text-slate-200">{state.url}</span></span>
            </div>
            <AgentTimeline steps={state.steps} isRunning />
          </div>
        )}

        {/* Done */}
        {state.phase === "done" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-sm text-slate-400">
                  Analysis complete · <span className="text-slate-300 font-mono text-xs truncate max-w-[200px] inline-block align-bottom">{state.url}</span>
                </span>
              </div>
              <button
                onClick={() => void handleScan(state.url)}
                className="text-xs text-slate-500 hover:text-brand-400 transition-colors flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Re-scan
              </button>
            </div>

            {/* Collapsed timeline */}
            <details className="glass rounded-xl group">
              <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none text-sm text-slate-400 hover:text-slate-300 transition-colors">
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Agent log · {state.steps.filter((s) => s.type === "tool_call").length} tools used
                </span>
                <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="px-4 pb-4 pt-1">
                <AgentTimeline steps={state.steps} isRunning={false} />
              </div>
            </details>

            <VerdictCard
              verdict={state.verdict}
              supplierMatches={state.supplierMatches}
              scanUrl={state.url}
            />
          </div>
        )}

        {/* Error */}
        {state.phase === "error" && (
          <div className="glass rounded-2xl border border-red-500/20 bg-red-500/5 p-6 fade-in-up">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center shrink-0 text-sm">
                ⚠️
              </div>
              <div className="flex-1">
                <p className="text-red-300 font-semibold text-sm">Scan failed</p>
                <p className="text-slate-500 text-sm mt-1">{state.message}</p>
                <button
                  onClick={() => void handleScan(state.url)}
                  className="mt-3 text-sm text-brand-400 hover:text-brand-300 transition-colors flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Try again
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-white/5 py-6 text-center">
        <p className="text-xs text-slate-600">
          Results are likelihood estimates, not definitive determinations.
        </p>
      </footer>
    </div>
  );
}
