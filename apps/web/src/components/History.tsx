import { useEffect, useState } from "react";
import { getHistory } from "../api.js";

interface HistoryScan {
  id: string;
  url: string;
  status: string;
  verdict?: { score: number; label: string } | null;
  createdAt: string;
}

interface Props {
  onSelect: (url: string) => void;
  onClose: () => void;
}

const LABEL_COLOR: Record<string, string> = {
  unlikely:       "text-emerald-400 bg-emerald-500/10",
  possible:       "text-amber-400 bg-amber-500/10",
  likely:         "text-orange-400 bg-orange-500/10",
  almost_certain: "text-red-400 bg-red-500/10",
};

export function History({ onSelect, onClose }: Props) {
  const [scans, setScans] = useState<HistoryScan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHistory()
      .then((rows) => setScans(rows as HistoryScan[]))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="glass rounded-2xl p-5 fade-in-up">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300">Recent scans</h2>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-4 justify-center">
          <span className="w-3 h-3 border-2 border-brand-500/50 border-t-brand-500 rounded-full animate-spin" />
          Loading…
        </div>
      ) : scans.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-4">No scans yet</p>
      ) : (
        <div className="space-y-1">
          {scans.map((scan) => {
            const lc = scan.verdict?.label ? LABEL_COLOR[scan.verdict.label] : null;
            return (
              <button
                key={scan.id}
                onClick={() => onSelect(scan.url)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors text-left gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-200 truncate">{scan.url}</p>
                  <p className="text-xs text-slate-600">{new Date(scan.createdAt).toLocaleString()}</p>
                </div>
                {scan.verdict && scan.status === "complete" && lc && (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${lc}`}>
                    {scan.verdict.score}
                  </span>
                )}
                {scan.status === "running" && (
                  <span className="text-xs text-brand-400 shrink-0">running…</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
