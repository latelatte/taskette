import type { DateString, GcalAssignment, Project, TaskTemplate, TimeBlock } from './domain/types.js';
import { DEFAULT_PROJECTS } from './projects.js';
import { DEFAULT_TEMPLATES } from './templates.js';

const STORAGE_KEY = 'taskette/v1';
const SCHEMA_VERSION = 1;
const MINUTES_PER_DAY = 1440;

export type StoredState = {
  blocksByDate: Record<DateString, readonly TimeBlock[]>;
  projects: readonly Project[];
  templates: readonly TaskTemplate[];
  gcalAssignments: Record<string, GcalAssignment>;
  gcalSummaryRules: Record<string, { readonly projectId?: string; readonly hidden?: true }>;
};

const emptyState = (): StoredState => ({
  blocksByDate: {},
  projects: DEFAULT_PROJECTS,
  templates: DEFAULT_TEMPLATES,
  gcalAssignments: {},
  gcalSummaryRules: {},
});

const isTimeBlock = (v: unknown): v is TimeBlock => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) return false;
  if (typeof o.label !== 'string') return false;
  if (typeof o.start !== 'number' || !Number.isFinite(o.start) || o.start < 0 || o.start > MINUTES_PER_DAY) return false;
  if (typeof o.durationMin !== 'number' || !Number.isFinite(o.durationMin) || o.durationMin <= 0) return false;
  if (o.start + o.durationMin > MINUTES_PER_DAY) return false;
  if (o.templateId !== undefined && typeof o.templateId !== 'string') return false;
  if (o.projectId !== undefined && typeof o.projectId !== 'string') return false;
  if (o.source !== undefined && o.source !== 'gcal') return false;
  if (o.gcalKey !== undefined && typeof o.gcalKey !== 'string') return false;
  if (o.gcalRecurring !== undefined && o.gcalRecurring !== true) return false;
  return true;
};

const sanitizeProjectOverrides = (p: Project): Project => {
  const ov = p.monthlyBudgetOverrides;
  if (ov === undefined) return p;
  const dropOverrides = (): Project => ({
    id: p.id,
    name: p.name,
    color: p.color,
    ...(p.monthlyBudget !== undefined ? { monthlyBudget: p.monthlyBudget } : {}),
  });
  if (typeof ov !== 'object' || ov === null || Array.isArray(ov)) return dropOverrides();
  const clean: Record<string, number> = {};
  for (const [k, val] of Object.entries(ov)) {
    if (/^\d{4}-\d{2}$/.test(k) && typeof val === 'number' && Number.isFinite(val) && val >= 0) {
      clean[k] = val;
    }
  }
  if (Object.keys(clean).length === 0) return dropOverrides();
  return { ...p, monthlyBudgetOverrides: clean };
};

const isTaskTemplate = (v: unknown): v is TaskTemplate => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) return false;
  if (typeof o.label !== 'string') return false;
  if (typeof o.defaultDurationMin !== 'number' || !Number.isFinite(o.defaultDurationMin) || o.defaultDurationMin <= 0 || o.defaultDurationMin > MINUTES_PER_DAY) return false;
  if (o.color !== undefined && typeof o.color !== 'string') return false;
  if (o.projectId !== undefined && typeof o.projectId !== 'string') return false;
  return true;
};

const sanitizeGcalSummaryRules = (
  raw: unknown,
  validProjectIds: ReadonlySet<string>,
): Record<string, { projectId?: string; hidden?: true }> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, { projectId?: string; hidden?: true }> = {};
  for (const [summary, val] of Object.entries(raw as Record<string, unknown>)) {
    if (summary.length === 0) continue;
    if (typeof val !== 'object' || val === null) continue;
    const v = val as Record<string, unknown>;
    let next: { projectId?: string; hidden?: true } = {};
    if (typeof v.projectId === 'string' && validProjectIds.has(v.projectId)) {
      next = { ...next, projectId: v.projectId };
    }
    if (v.hidden === true) {
      next = { ...next, hidden: true };
    }
    if (next.projectId === undefined && next.hidden !== true) continue;
    out[summary] = next;
  }
  return out;
};

const sanitizeGcalAssignments = (
  raw: unknown,
  validProjectIds: ReadonlySet<string>,
): Record<string, GcalAssignment> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, GcalAssignment> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val !== 'object' || val === null) continue;
    const v = val as Record<string, unknown>;
    const a: GcalAssignment = {};
    let next: GcalAssignment = a;
    if (typeof v.projectId === 'string' && validProjectIds.has(v.projectId)) {
      next = { ...next, projectId: v.projectId };
    }
    if (v.hidden === true) {
      next = { ...next, hidden: true };
    }
    if (typeof v.summary === 'string') {
      next = { ...next, summary: v.summary };
    }
    if (next.projectId === undefined && next.hidden !== true) continue; // 意味のないエントリは drop
    out[key] = next;
  }
  return out;
};

export const loadStore = (): StoredState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return emptyState();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return emptyState();
    const obj = parsed as Record<string, unknown>;

    if (obj.version !== SCHEMA_VERSION) return emptyState();

    const projects: readonly Project[] = Array.isArray(obj.projects)
      ? (obj.projects as readonly Project[]).map(sanitizeProjectOverrides)
      : DEFAULT_PROJECTS;

    const validProjectIds = new Set(projects.map((p) => p.id));

    const stripBlockProjectId = (b: TimeBlock): TimeBlock => ({
      id: b.id,
      label: b.label,
      start: b.start,
      durationMin: b.durationMin,
      ...(b.templateId !== undefined ? { templateId: b.templateId } : {}),
    });

    const stripTemplateProjectId = (t: TaskTemplate): TaskTemplate => ({
      id: t.id,
      label: t.label,
      defaultDurationMin: t.defaultDurationMin,
      ...(t.color !== undefined ? { color: t.color } : {}),
    });

    const blocksByDate: Record<DateString, readonly TimeBlock[]> = {};
    if (typeof obj.blocksByDate === 'object' && obj.blocksByDate !== null) {
      for (const [date, dayBlocks] of Object.entries(obj.blocksByDate)) {
        if (!Array.isArray(dayBlocks)) continue;
        const valid = dayBlocks
          .filter(isTimeBlock)
          .map((b) =>
            b.projectId !== undefined && !validProjectIds.has(b.projectId)
              ? stripBlockProjectId(b)
              : b,
          );
        if (valid.length > 0) blocksByDate[date] = valid;
      }
    }

    const templates: readonly TaskTemplate[] = Array.isArray(obj.templates)
      ? obj.templates
          .filter(isTaskTemplate)
          .map((t) =>
            t.projectId !== undefined && !validProjectIds.has(t.projectId)
              ? stripTemplateProjectId(t)
              : t,
          )
      : DEFAULT_TEMPLATES;

    const gcalAssignments = sanitizeGcalAssignments(obj.gcalAssignments, validProjectIds);
    const gcalSummaryRules = sanitizeGcalSummaryRules(obj.gcalSummaryRules, validProjectIds);

    return { blocksByDate, projects, templates, gcalAssignments, gcalSummaryRules };
  } catch {
    return emptyState();
  }
};

export const saveStore = (state: StoredState): void => {
  try {
    const filteredBlocks: Record<DateString, readonly TimeBlock[]> = {};
    for (const [date, dayBlocks] of Object.entries(state.blocksByDate)) {
      const native = dayBlocks.filter((b) => b.source !== 'gcal');
      if (native.length > 0) filteredBlocks[date] = native;
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, ...state, blocksByDate: filteredBlocks }),
    );
  } catch {
    // localStorage unavailable or quota exceeded — silently ignore for PoC
  }
};
