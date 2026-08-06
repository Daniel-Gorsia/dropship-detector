interface Props {
  score: number;
  label: string;
}

const CONFIG: Record<string, { color: string; trackColor: string; textColor: string; bg: string; label: string }> = {
  unlikely:      { color: "#34d399", trackColor: "#064e3b", textColor: "text-emerald-400", bg: "from-emerald-500/10 to-emerald-500/5", label: "Unlikely" },
  possible:      { color: "#fbbf24", trackColor: "#451a03", textColor: "text-amber-400",   bg: "from-amber-500/10 to-amber-500/5",   label: "Possible" },
  likely:        { color: "#f97316", trackColor: "#431407", textColor: "text-orange-400",  bg: "from-orange-500/10 to-orange-500/5", label: "Likely" },
  almost_certain:{ color: "#f87171", trackColor: "#450a0a", textColor: "text-red-400",     bg: "from-red-500/10 to-red-500/5",       label: "Almost Certain" },
};

export function ScoreGauge({ score, label }: Props) {
  const cfg = CONFIG[label] ?? CONFIG["possible"]!;
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className={`relative w-40 h-40 rounded-full bg-gradient-to-br ${cfg.bg} flex items-center justify-center`}>
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 120 120">
          {/* Track */}
          <circle cx="60" cy="60" r={r} fill="none" stroke={cfg.trackColor} strokeWidth="8" />
          {/* Progress */}
          <circle
            cx="60" cy="60" r={r}
            fill="none"
            stroke={cfg.color}
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)", filter: `drop-shadow(0 0 6px ${cfg.color}80)` }}
          />
        </svg>
        <div className="relative flex flex-col items-center">
          <span className="text-4xl font-bold tracking-tight" style={{ color: cfg.color }}>{score}</span>
          <span className="text-xs text-slate-500 font-medium">/ 100</span>
        </div>
      </div>
      <span className={`text-base font-semibold ${cfg.textColor}`}>{cfg.label}</span>
    </div>
  );
}
