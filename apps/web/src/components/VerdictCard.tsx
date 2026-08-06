import type { Verdict, SupplierMatch } from "@dropship/shared";
import { ScoreGauge } from "./ScoreGauge.js";

interface Props {
  verdict: Verdict;
  supplierMatches?: SupplierMatch[];
  scanUrl: string;
}

const DIRECTION_CONFIG: Record<string, { border: string; bg: string; icon: string; dot: string }> = {
  dropship: { border: "border-l-red-500",    bg: "bg-red-500/5",    icon: "↑", dot: "bg-red-400" },
  legit:    { border: "border-l-emerald-500", bg: "bg-emerald-500/5", icon: "↓", dot: "bg-emerald-400" },
  neutral:  { border: "border-l-slate-600",  bg: "bg-white/2",     icon: "–", dot: "bg-slate-500" },
};

const WEIGHT_CONFIG: Record<string, { label: string; color: string }> = {
  strong:   { label: "Strong",   color: "bg-slate-700 text-slate-200 border border-slate-600" },
  moderate: { label: "Moderate", color: "bg-slate-800 text-slate-400 border border-slate-700" },
  weak:     { label: "Weak",     color: "bg-transparent text-slate-500 border border-slate-800" },
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high:   "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  medium: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  low:    "text-slate-400 bg-slate-500/10 border-slate-500/20",
};

export function VerdictCard({ verdict, supplierMatches = [], scanUrl }: Props) {
  const shareUrl = `${window.location.origin}/?url=${encodeURIComponent(scanUrl)}`;
  const verifiedMatches = supplierMatches.filter((m) => m.matchConfidence !== "similar_product");
  const confCfg = CONFIDENCE_COLOR[verdict.confidence] ?? CONFIDENCE_COLOR["low"]!;

  return (
    <div className="space-y-4 fade-in-up">

      {/* Score hero */}
      <div className="glass rounded-2xl p-6 glow-indigo">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <ScoreGauge score={verdict.score} label={verdict.label} />

          <div className="flex-1 space-y-3 text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${confCfg}`}>
                {verdict.confidence.toUpperCase()} CONFIDENCE
              </span>
              <span className="text-xs text-slate-500">{verdict.evidence.length} signals checked</span>
            </div>

            <p className="text-slate-300 text-sm leading-relaxed">{verdict.reasoning}</p>

            <button
              onClick={() => void navigator.clipboard.writeText(shareUrl)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg glass glass-hover transition-all text-slate-400 hover:text-slate-200"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share result
            </button>
          </div>
        </div>
      </div>

      {/* Supplier match banner */}
      {verifiedMatches.length > 0 && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5 glow-red">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">🚨</span>
            <h3 className="text-sm font-semibold text-red-300">Same item found cheaper</h3>
          </div>
          <div className="space-y-2">
            {verifiedMatches.map((m, i) => (
              <a
                key={i}
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 rounded-xl bg-red-500/8 hover:bg-red-500/12 border border-red-500/15 transition-all group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-300 text-sm font-medium capitalize truncate">
                    {m.marketplace.replace(".com", "")}
                  </span>
                  <span className="text-xs text-slate-500 shrink-0">
                    {m.matchConfidence === "exact" ? "exact match" : "likely same"}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {m.price !== undefined && (
                    <span className="text-base font-bold text-emerald-400">${m.price.toFixed(2)}</span>
                  )}
                  {m.markupMultiplier !== undefined && m.markupMultiplier > 1 && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">
                      {m.markupMultiplier}× markup
                    </span>
                  )}
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-slate-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Evidence */}
      {verdict.evidence.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3 px-1">
            Evidence
          </h3>
          <div className="space-y-2">
            {verdict.evidence.map((e, i) => {
              const dcfg = DIRECTION_CONFIG[e.direction] ?? DIRECTION_CONFIG["neutral"]!;
              const wcfg = WEIGHT_CONFIG[e.weight] ?? WEIGHT_CONFIG["weak"]!;
              return (
                <div
                  key={i}
                  className={`rounded-xl border-l-2 ${dcfg.border} ${dcfg.bg} border border-white/5 px-4 py-3 fade-in-up`}
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dcfg.dot}`} />
                        <span className="text-xs font-mono text-slate-500">{e.signal}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${wcfg.color}`}>
                          {wcfg.label}
                        </span>
                      </div>
                      <p className="text-sm text-slate-300 leading-snug">{e.finding}</p>
                      {e.sourceUrl && (
                        <a
                          href={e.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-brand-400/60 hover:text-brand-400 underline underline-offset-2 mt-1 inline-block transition-colors"
                        >
                          View source ↗
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-600 text-center pt-1">
        Results are probabilistic estimates, not definitive determinations.
      </p>
    </div>
  );
}
