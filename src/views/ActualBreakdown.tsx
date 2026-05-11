import type { Project } from '../domain/types.js';
import type { Aggregate } from '../domain/aggregate.js';

const FALLBACK_BLOCK_COLOR = '#A39A92';
const UNASSIGNED_COLOR = '#B5B0A8';

type Props = {
  readonly title: string;
  readonly aggregate: Aggregate;
  readonly projects: readonly Project[];
  readonly projectById: ReadonlyMap<string, Project>;
};

// Tooltip content showing per-project breakdown for a date / period.
// Used by Week/Month per-day cells where space is too tight for inline labels.
export function ActualBreakdown({ title, aggregate, projects, projectById }: Props) {
  const assignedMin = Array.from(aggregate.byProject.values()).reduce((a, b) => a + b, 0);
  const totalMin = assignedMin + aggregate.unassigned;
  if (totalMin === 0) {
    return (
      <div className="space-y-1 min-w-[180px]">
        <div className="text-[11px] font-semibold text-foreground">{title}</div>
        <div className="text-[11px] text-muted-foreground">登録なし</div>
      </div>
    );
  }
  const rows: { color: string; name: string; min: number }[] = [];
  for (const p of projects) {
    const m = aggregate.byProject.get(p.id) ?? 0;
    if (m > 0) rows.push({ color: p.color, name: p.name, min: m });
  }
  for (const [pid, m] of aggregate.byProject) {
    if (!projectById.has(pid) && m > 0) {
      rows.push({ color: FALLBACK_BLOCK_COLOR, name: '(削除済み案件)', min: m });
    }
  }
  if (aggregate.unassigned > 0) {
    rows.push({ color: UNASSIGNED_COLOR, name: '未割当', min: aggregate.unassigned });
  }
  return (
    <div className="space-y-1.5 min-w-[200px]">
      <div className="text-[11px] font-semibold text-foreground">{title}</div>
      <div className="space-y-0.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span
              className="w-2 h-2 rounded-[2px] shrink-0"
              style={{ background: r.color }}
            />
            <span className="text-foreground/80 flex-1 truncate">{r.name}</span>
            <span className="text-foreground/85 tabular-nums shrink-0">
              {(r.min / 60).toFixed(1)}h
            </span>
          </div>
        ))}
      </div>
      <div className="border-t border-border/60 pt-1 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground font-semibold tracking-wide uppercase">合計</span>
        <span className="text-foreground font-semibold tabular-nums">
          {(totalMin / 60).toFixed(1)}h
        </span>
      </div>
    </div>
  );
}
