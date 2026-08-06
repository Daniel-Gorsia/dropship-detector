import type { AgentStep } from "@dropship/shared";

interface Props {
  steps: AgentStep[];
  isRunning: boolean;
}

const TOOL_CONFIG: Record<string, { label: string; icon: string; category: "free" | "paid" }> = {
  get_store_fingerprint:       { label: "Analyzing store fingerprint",       icon: "🏪", category: "free" },
  check_domain_age:            { label: "Checking domain age",               icon: "📅", category: "free" },
  check_shipping_policy:       { label: "Reading shipping policy",           icon: "🚢", category: "free" },
  check_description_plagiarism:{ label: "Checking description plagiarism",   icon: "📋", category: "paid" },
  find_supplier_matches:       { label: "Searching for supplier matches",    icon: "🔍", category: "paid" },
  compare_prices:              { label: "Comparing prices across stores",    icon: "💰", category: "paid" },
  submit_verdict:              { label: "Verdict ready",                     icon: "✓",  category: "free" },
};

export function AgentTimeline({ steps, isRunning }: Props) {
  const toolCalls = steps.filter((s) => s.type === "tool_call");
  const toolResults = new Map(
    steps.filter((s) => s.type === "tool_result").map((s) => [s.tool, s])
  );

  return (
    <div className="space-y-3">
      {isRunning && toolCalls.length === 0 && (
        <div className="flex items-center gap-3 py-2">
          <div className="w-8 h-8 rounded-full glass flex items-center justify-center flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-brand-400 animate-ping" />
          </div>
          <span className="text-sm text-slate-400">Starting analysis…</span>
        </div>
      )}

      {toolCalls.map((step, i) => {
        const cfg = TOOL_CONFIG[step.tool ?? ""] ?? { label: step.tool ?? "", icon: "⚙️", category: "free" as const };
        const result = toolResults.get(step.tool ?? "");
        const isDone = !!result;
        const isActive = !isDone && isRunning && i === toolCalls.length - 1;
        const isVerdict = step.tool === "submit_verdict";

        return (
          <div key={i} className="relative flex items-start gap-3 fade-in-up" style={{ animationDelay: `${i * 60}ms` }}>
            {/* Connector line */}
            {i < toolCalls.length - 1 && (
              <div className="absolute left-4 top-9 bottom-0 w-px bg-gradient-to-b from-slate-600/50 to-transparent" />
            )}

            {/* Icon */}
            <div
              className={`relative w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0 transition-all duration-300 ${
                isVerdict && isDone
                  ? "bg-brand-500/20 border border-brand-500/50 shadow-[0_0_12px_rgba(99,102,241,0.3)]"
                  : isActive
                  ? "bg-brand-500/15 border border-brand-500/40 animate-pulse-soft"
                  : isDone
                  ? "glass border-white/10"
                  : "glass border-white/5 opacity-50"
              }`}
            >
              <span className={isVerdict && isDone ? "text-sm" : ""}>{cfg.icon}</span>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pt-1">
              <div className="flex items-center gap-2">
                <p className={`text-sm font-medium transition-colors ${
                  isDone ? "text-slate-200" : isActive ? "text-slate-300" : "text-slate-500"
                }`}>
                  {cfg.label}
                </p>
                {cfg.category === "paid" && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400/80">
                    API
                  </span>
                )}
              </div>
              {isDone && result?.output !== undefined && (
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {summarizeResult(step.tool ?? "", result.output)}
                </p>
              )}
              {isActive && (
                <div className="mt-1.5 h-1 w-24 rounded-full overflow-hidden bg-slate-800">
                  <div className="h-full shimmer rounded-full" />
                </div>
              )}
            </div>

            {/* Status */}
            <div className="pt-1.5 flex-shrink-0">
              {isActive ? (
                <span className="text-xs text-brand-400 font-medium">running</span>
              ) : isDone ? (
                <span className={`text-xs font-medium ${isVerdict ? "text-brand-400" : "text-emerald-500"}`}>✓</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function summarizeResult(tool: string, output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const o = output as Record<string, unknown>;

  if (tool === "check_domain_age") {
    const age = o["ageInDays"];
    if (age !== null && age !== undefined)
      return `${age} days old`;
    return "Domain age unknown";
  }
  if (tool === "get_store_fingerprint") {
    const platform = o["platform"];
    const apps = (o["dropshipApps"] as string[] | undefined) ?? [];
    const parts = [platform && `${platform}`, apps.length > 0 && `${apps.join(", ")} detected`].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "No platform detected";
  }
  if (tool === "check_shipping_policy") {
    const flags = (o["redFlags"] as string[] | undefined) ?? [];
    if (flags.length > 0) return flags[0] ?? "";
    return "No red flags found";
  }
  if (tool === "find_supplier_matches") {
    const inner = o["matches"];
    const matches = Array.isArray(inner) ? inner : Array.isArray(output) ? output : [];
    if (matches.length > 0) {
      const m = matches[0] as Record<string, unknown>;
      const price = m["price"] ? `$${m["price"]}` : "";
      return `Found on ${m["marketplace"] ?? "marketplace"}${price ? ` — ${price}` : ""}`;
    }
    return "No matches found";
  }
  if (tool === "check_description_plagiarism") {
    const count = o["matchCount"];
    return count !== undefined ? `${count} matching stores found` : "";
  }
  return "";
}
