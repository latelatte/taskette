import type { DateString, Project, ProjectEnergy, TimeBlock } from './types.js';
import type { FocusWindow } from './focus.js';
import { effectiveBudgetPM, HOURS_PER_PERSON_MONTH } from './budget.js';

export type ProposedBlock = {
  readonly date: DateString;
  readonly projectId: string;
  readonly start: string;
  readonly end: string;
  readonly energy: ProjectEnergy;
  readonly reason: string;
  readonly score: number;
};

export type ProposeAllocationInput = {
  /** Range of days to allocate over. Caller decides which days are eligible
   *  (typically business days). Sorted ascending internally. */
  readonly dates: readonly DateString[];
  readonly pinnedProjects: readonly Project[];
  readonly existingBlocksByDate: Readonly<Record<DateString, readonly TimeBlock[]>>;
  readonly focusWindows: readonly FocusWindow[];
  readonly budgetContext: {
    readonly spentByProjectThisMonth: Readonly<Record<string, number>>;
    readonly monthRemainingBusinessDays: number;
    readonly targetMonth: string;
  };
  readonly options?: {
    readonly minBlockMinutes?: number;
    readonly maxBlockMinutes?: number;
    readonly snapMinutes?: number;
    readonly restBufferMinutes?: number;
  };
};

const DEFAULT_OPTS = {
  minBlockMinutes: 30,
  maxBlockMinutes: 120,
  snapMinutes: 15,
  restBufferMinutes: 15,
};

const parseHHMM = (s: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m === null) return 0;
  return parseInt(m[1] ?? '0', 10) * 60 + parseInt(m[2] ?? '0', 10);
};

const formatHHMM = (m: number): string => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
};

const fmtH = (h: number): string => {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? r.toString() : r.toFixed(1);
};

const ENERGY_ORDER: Record<ProjectEnergy, number> = { low: 0, mid: 1, high: 2 };
const ENERGY_LABEL_LOCAL: Record<ProjectEnergy, string> = { low: '軽', mid: '中', high: '重' };

const energyMatchScore = (a: ProjectEnergy, b: ProjectEnergy): number =>
  Math.max(0, 2 - Math.abs(ENERGY_ORDER[a] - ENERGY_ORDER[b]));

type FreeSlot = { readonly start: number; readonly end: number };
type EnergySegment = { readonly start: number; readonly end: number; readonly energy: ProjectEnergy };

const computeFreeSlots = (blocks: readonly TimeBlock[]): FreeSlot[] => {
  const occupied = [...blocks].sort((a, b) => a.start - b.start);
  const slots: FreeSlot[] = [];
  let cursor = 0;
  for (const b of occupied) {
    if (b.start > cursor) slots.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.start + b.durationMin);
  }
  if (cursor < 1440) slots.push({ start: cursor, end: 1440 });
  return slots;
};

const buildEnergySegments = (
  freeSlots: readonly FreeSlot[],
  windows: readonly FocusWindow[],
): EnergySegment[] => {
  const segs: EnergySegment[] = [];
  for (const slot of freeSlots) {
    for (const w of windows) {
      const ws = parseHHMM(w.start);
      const we = parseHHMM(w.end);
      const s = Math.max(slot.start, ws);
      const e = Math.min(slot.end, we);
      if (e > s) segs.push({ start: s, end: e, energy: w.energy });
    }
  }
  segs.sort((a, b) => a.start - b.start || a.end - b.end);
  // Dedupe overlapping segments deterministically: keep first, trim later starts forward.
  // Prevents double-allocation when focus windows themselves overlap.
  const deduped: EnergySegment[] = [];
  let frontier = -1;
  for (const s of segs) {
    const start = Math.max(s.start, frontier);
    if (start >= s.end) continue;
    deduped.push({ start, end: s.end, energy: s.energy });
    frontier = s.end;
  }
  return deduped;
};

const snapDown = (m: number, snap: number): number => Math.floor(m / snap) * snap;
const snapUp = (m: number, snap: number): number => Math.ceil(m / snap) * snap;

type ProjectCtx = {
  readonly project: Project;
  readonly remainingH: number;
  readonly dailyTargetH: number;
  /** Allocation budget shared across all dates in the input range.
   *  Period cap = dailyTarget × |dates| so the engine doesn't consume the
   *  whole month's remaining budget when the caller only spans a week. */
  remainingPeriodMin: number;
  readonly score: number;
};

export const proposeAllocation = (
  input: ProposeAllocationInput,
): readonly ProposedBlock[] => {
  const opts = { ...DEFAULT_OPTS, ...(input.options ?? {}) };
  const { dates, focusWindows, existingBlocksByDate, pinnedProjects, budgetContext } = input;

  if (budgetContext.monthRemainingBusinessDays <= 0) return [];

  // Defensive: dedupe and clamp to targetMonth so a misuse (cross-month dates,
  // duplicates) cannot inflate the period cap or produce duplicate proposals.
  // Callers spanning multiple months must split by month and invoke per group.
  const sortedDates = [...new Set(dates)]
    .filter((d) => d.slice(0, 7) === budgetContext.targetMonth)
    .sort();
  if (sortedDates.length === 0) return [];

  const ctxs: ProjectCtx[] = [];
  for (const p of pinnedProjects) {
    if (!p.pinned) continue;
    const budgetPM = effectiveBudgetPM(p, budgetContext.targetMonth);
    if (budgetPM === undefined || budgetPM <= 0) continue;
    const budgetH = budgetPM * HOURS_PER_PERSON_MONTH;
    const spent = budgetContext.spentByProjectThisMonth[p.id] ?? 0;
    const remainingH = budgetH - spent;
    if (remainingH <= 0) continue;
    const dailyTargetH = remainingH / budgetContext.monthRemainingBusinessDays;
    const periodH = dailyTargetH * sortedDates.length;
    const urgency = budgetH > 0 ? remainingH / budgetH : 0;
    const score = dailyTargetH * (1 + urgency);
    ctxs.push({
      project: p,
      remainingH,
      dailyTargetH,
      remainingPeriodMin: Math.max(snapUp(periodH * 60, opts.snapMinutes), 0),
      score,
    });
  }
  if (ctxs.length === 0) return [];

  // (sortedDates already prepared above; greedy time-order pushes work earlier
  //  when later days are blocked — e.g., Wed full of meetings → spillover Tue.)
  const out: ProposedBlock[] = [];

  for (const date of sortedDates) {
    const dayBlocks = existingBlocksByDate[date] ?? [];
    const slots = computeFreeSlots(dayBlocks);
    const segs = buildEnergySegments(slots, focusWindows);
    if (segs.length === 0) continue;

    for (const seg of segs) {
      let cursor = seg.start;
      while (cursor < seg.end) {
        const segRemaining = seg.end - cursor;
        if (segRemaining < opts.minBlockMinutes) break;

        const eligible = ctxs.filter((c) => c.remainingPeriodMin >= opts.minBlockMinutes);
        if (eligible.length === 0) break;

        eligible.sort((a, b) => {
          const ma = energyMatchScore(a.project.energy, seg.energy);
          const mb = energyMatchScore(b.project.energy, seg.energy);
          if (ma !== mb) return mb - ma;
          if (a.score !== b.score) return b.score - a.score;
          return a.project.id < b.project.id ? -1 : 1;
        });

        const chosen = eligible[0];
        if (chosen === undefined) break;
        const desired = Math.min(segRemaining, opts.maxBlockMinutes, chosen.remainingPeriodMin);
        const size = snapDown(desired, opts.snapMinutes);
        if (size < opts.minBlockMinutes) break;

        const match = energyMatchScore(chosen.project.energy, seg.energy);
        const matchSuffix =
          match === 2
            ? `${ENERGY_LABEL_LOCAL[seg.energy]}負荷帯にマッチ`
            : match === 1
              ? `${ENERGY_LABEL_LOCAL[seg.energy]}負荷帯に近い配置`
              : `${ENERGY_LABEL_LOCAL[chosen.project.energy]}案件を${ENERGY_LABEL_LOCAL[seg.energy]}帯へ`;
        const reason = `残${fmtH(chosen.remainingH)}h・残営業日${budgetContext.monthRemainingBusinessDays} → 目安${fmtH(chosen.dailyTargetH)}h/日。${matchSuffix}。`;

        out.push({
          date,
          projectId: chosen.project.id,
          start: formatHHMM(cursor),
          end: formatHHMM(cursor + size),
          energy: chosen.project.energy,
          reason,
          score: chosen.score,
        });

        cursor += size;
        chosen.remainingPeriodMin -= size;

        if (chosen.project.energy === 'high' && cursor < seg.end) {
          cursor = Math.min(cursor + opts.restBufferMinutes, seg.end);
        }
      }
    }
  }

  return out;
};
