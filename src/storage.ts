import Database from '@tauri-apps/plugin-sql';
import type { DateString, GcalAssignment, Project, TaskTemplate, TimeBlock } from './domain/types.js';
import { DEFAULT_PROJECTS } from './projects.js';
import { DEFAULT_TEMPLATES } from './templates.js';

const STORAGE_KEY = 'taskette/v1';
const SCHEMA_VERSION = 1;
const MINUTES_PER_DAY = 1440;
const SQLITE_DB = 'sqlite:taskette.db';

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
  if (
    o.notifyOffsetMin !== undefined &&
    (typeof o.notifyOffsetMin !== 'number' ||
      !Number.isFinite(o.notifyOffsetMin) ||
      o.notifyOffsetMin < 0 ||
      o.notifyOffsetMin > 24 * 60)
  ) {
    return false;
  }
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
    let next: GcalAssignment = {};
    if (typeof v.projectId === 'string' && validProjectIds.has(v.projectId)) {
      next = { ...next, projectId: v.projectId };
    }
    if (v.hidden === true) {
      next = { ...next, hidden: true };
    }
    if (typeof v.summary === 'string') {
      next = { ...next, summary: v.summary };
    }
    if (next.projectId === undefined && next.hidden !== true) continue;
    out[key] = next;
  }
  return out;
};

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

/**
 * Parse and validate a raw JSON object into a StoredState.
 * Returns null if the payload is unrecognizable; emptyState() callers may fall back.
 */
const parseStoredPayload = (parsed: unknown): StoredState | null => {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== SCHEMA_VERSION) return null;

  const projects: readonly Project[] = Array.isArray(obj.projects)
    ? (obj.projects as readonly Project[]).map(sanitizeProjectOverrides)
    : DEFAULT_PROJECTS;

  const validProjectIds = new Set(projects.map((p) => p.id));

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
};

const stripGcalBlocks = (state: StoredState): StoredState => {
  const filteredBlocks: Record<DateString, readonly TimeBlock[]> = {};
  for (const [date, dayBlocks] of Object.entries(state.blocksByDate)) {
    const native = dayBlocks.filter((b) => b.source !== 'gcal');
    if (native.length > 0) filteredBlocks[date] = native;
  }
  return { ...state, blocksByDate: filteredBlocks };
};

export type GcalEventRecord = {
  readonly calendarId: string;
  readonly eventId: string;
  readonly summary: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly isRecurring: boolean;
  readonly recurringEventId: string | null;
  readonly htmlLink: string | null;
};

export type GcalSyncRunInput = {
  readonly calendarId: string;
  readonly syncRunId: string;
  readonly runStartedAt: number;
  readonly timeMinMs: number;
  readonly timeMaxMs: number;
  readonly events: readonly GcalEventRecord[];
};

interface StorageBackend {
  load(): Promise<StoredState>;
  save(next: StoredState): Promise<void>;
  importStoredJson(raw: string): Promise<StoredState>;
  loadGcalEvents(calendarId: string): Promise<readonly GcalEventRecord[]>;
  applyGcalSyncRun(args: GcalSyncRunInput): Promise<void>;
  clearGcalEvents(calendarId: string): Promise<void>;
}

class LocalStorageBackend implements StorageBackend {
  load(): Promise<StoredState> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return Promise.resolve(emptyState());
      const parsed: unknown = JSON.parse(raw);
      return Promise.resolve(parseStoredPayload(parsed) ?? emptyState());
    } catch {
      return Promise.resolve(emptyState());
    }
  }

  save(next: StoredState): Promise<void> {
    try {
      const filtered = stripGcalBlocks(next);
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: SCHEMA_VERSION, ...filtered }),
      );
    } catch {
      // localStorage unavailable or quota exceeded — silently ignore
    }
    return Promise.resolve();
  }

  async importStoredJson(raw: string): Promise<StoredState> {
    const parsed: unknown = JSON.parse(raw);
    const state = parseStoredPayload(parsed);
    if (state === null) throw new Error('Invalid taskette JSON payload');
    await this.save(state);
    return state;
  }

  loadGcalEvents(_calendarId: string): Promise<readonly GcalEventRecord[]> {
    return Promise.resolve([]);
  }
  applyGcalSyncRun(_args: GcalSyncRunInput): Promise<void> {
    return Promise.resolve();
  }
  clearGcalEvents(_calendarId: string): Promise<void> {
    return Promise.resolve();
  }
}

const generateDeviceId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
};

class SqliteBackend implements StorageBackend {
  private dbPromise: Promise<Database> | null = null;
  private cachedState: StoredState = { blocksByDate: {}, projects: [], templates: [], gcalAssignments: {}, gcalSummaryRules: {} };
  private deviceId = '';

  private getDb(): Promise<Database> {
    if (this.dbPromise === null) {
      this.dbPromise = (async () => {
        const db = await Database.load(SQLITE_DB);
        const rows = await db.select<{ value: string }[]>(
          "SELECT value FROM settings WHERE key = 'device_id'",
        );
        const first = rows[0];
        if (first === undefined) {
          this.deviceId = generateDeviceId();
          await db.execute(
            'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
            ['device_id', this.deviceId, Date.now()],
          );
        } else {
          this.deviceId = first.value;
        }
        return db;
      })();
    }
    return this.dbPromise;
  }

  async load(): Promise<StoredState> {
    const db = await this.getDb();

    const projectRows = await db.select<{
      id: string;
      name: string;
      color: string;
      monthly_budget_pm: number | null;
    }[]>(
      'SELECT id, name, color, monthly_budget_pm FROM projects WHERE deleted_at IS NULL',
    );

    const overrideRows = await db.select<{
      project_id: string;
      ym: string;
      hours: number;
    }[]>(
      'SELECT project_id, ym, hours FROM project_budget_overrides WHERE deleted_at IS NULL',
    );
    const overrideMap: Record<string, Record<string, number>> = {};
    for (const o of overrideRows) {
      const map = overrideMap[o.project_id] ?? {};
      map[o.ym] = o.hours;
      overrideMap[o.project_id] = map;
    }

    const projects: Project[] = projectRows.map((r) => {
      const obj: { id: string; name: string; color: string; monthlyBudget?: number; monthlyBudgetOverrides?: Record<string, number> } = {
        id: r.id,
        name: r.name,
        color: r.color,
      };
      if (r.monthly_budget_pm !== null) obj.monthlyBudget = r.monthly_budget_pm;
      const ov = overrideMap[r.id];
      if (ov !== undefined && Object.keys(ov).length > 0) obj.monthlyBudgetOverrides = ov;
      return obj;
    });

    const templateRows = await db.select<{
      id: string;
      label: string;
      color: string | null;
      project_id: string | null;
      default_duration_min: number;
    }[]>(
      'SELECT id, label, color, project_id, default_duration_min FROM templates WHERE deleted_at IS NULL',
    );
    const templates: TaskTemplate[] = templateRows.map((r) => {
      const obj: { id: string; label: string; defaultDurationMin: number; color?: string; projectId?: string } = {
        id: r.id,
        label: r.label,
        defaultDurationMin: r.default_duration_min,
      };
      if (r.color !== null) obj.color = r.color;
      if (r.project_id !== null) obj.projectId = r.project_id;
      return obj;
    });

    const blockRows = await db.select<{
      id: string;
      date: string;
      start_min: number;
      duration_min: number;
      label: string;
      project_id: string | null;
      template_id: string | null;
      source: string | null;
      gcal_key: string | null;
      notify_offset_min: number | null;
    }[]>(
      'SELECT id, date, start_min, duration_min, label, project_id, template_id, source, gcal_key, notify_offset_min FROM blocks WHERE deleted_at IS NULL',
    );
    const blocksByDate: Record<DateString, TimeBlock[]> = {};
    for (const r of blockRows) {
      const block: TimeBlock = {
        id: r.id,
        label: r.label,
        start: r.start_min,
        durationMin: r.duration_min,
        ...(r.template_id !== null ? { templateId: r.template_id } : {}),
        ...(r.project_id !== null ? { projectId: r.project_id } : {}),
        ...(r.source === 'gcal' ? { source: 'gcal' as const } : {}),
        ...(r.gcal_key !== null ? { gcalKey: r.gcal_key } : {}),
        ...(r.notify_offset_min !== null ? { notifyOffsetMin: r.notify_offset_min } : {}),
      };
      const list = blocksByDate[r.date] ?? [];
      list.push(block);
      blocksByDate[r.date] = list;
    }

    const gaRows = await db.select<{
      gcal_key: string;
      project_id: string | null;
      hidden: number;
      summary: string | null;
    }[]>(
      'SELECT gcal_key, project_id, hidden, summary FROM gcal_assignments WHERE deleted_at IS NULL',
    );
    const gcalAssignments: Record<string, GcalAssignment> = {};
    for (const r of gaRows) {
      const obj: { projectId?: string; hidden?: true; summary?: string } = {};
      if (r.project_id !== null) obj.projectId = r.project_id;
      if (r.hidden === 1) obj.hidden = true;
      if (r.summary !== null) obj.summary = r.summary;
      gcalAssignments[r.gcal_key] = obj;
    }

    const gsRows = await db.select<{
      summary: string;
      project_id: string | null;
      hidden: number;
    }[]>(
      'SELECT summary, project_id, hidden FROM gcal_summary_rules WHERE deleted_at IS NULL',
    );
    const gcalSummaryRules: Record<string, { projectId?: string; hidden?: true }> = {};
    for (const r of gsRows) {
      const v: { projectId?: string; hidden?: true } = {};
      if (r.project_id !== null) v.projectId = r.project_id;
      if (r.hidden === 1) v.hidden = true;
      gcalSummaryRules[r.summary] = v;
    }

    const isFresh =
      projects.length === 0 &&
      templates.length === 0 &&
      Object.keys(blocksByDate).length === 0 &&
      Object.keys(gcalAssignments).length === 0 &&
      Object.keys(gcalSummaryRules).length === 0;

    if (isFresh) {
      const seeded: StoredState = {
        blocksByDate: {},
        projects: DEFAULT_PROJECTS,
        templates: DEFAULT_TEMPLATES,
        gcalAssignments: {},
        gcalSummaryRules: {},
      };
      await this.save(seeded);
      return seeded;
    }

    const state: StoredState = { blocksByDate, projects, templates, gcalAssignments, gcalSummaryRules };
    this.cachedState = state;
    return state;
  }

  async save(next: StoredState): Promise<void> {
    const db = await this.getDb();
    const filtered = stripGcalBlocks(next);
    const prev = this.cachedState;
    const now = Date.now();
    const dev = this.deviceId;

    // tauri-plugin-sql 2.x has no explicit transaction API; each db.execute()
    // is its own auto-commit. We rely on diff-based save: a partial failure
    // self-heals on the next save() because cachedState is only advanced after
    // the full pass succeeds.
    {
      // projects
      const prevProjMap = new Map(prev.projects.map((p) => [p.id, p]));
      const nextProjMap = new Map(filtered.projects.map((p) => [p.id, p]));
      for (const [id, p] of nextProjMap) {
        const old = prevProjMap.get(id);
        if (old === undefined) {
          await db.execute(
            'INSERT INTO projects (id, name, color, monthly_budget_pm, created_at, updated_at, created_by_device_id, updated_by_device_id, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, monthly_budget_pm = excluded.monthly_budget_pm, deleted_at = NULL, updated_at = excluded.updated_at, updated_by_device_id = excluded.updated_by_device_id, revision = projects.revision + 1',
            [id, p.name, p.color, p.monthlyBudget ?? null, now, now, dev, dev],
          );
        } else if (old.name !== p.name || old.color !== p.color || old.monthlyBudget !== p.monthlyBudget) {
          await db.execute(
            'UPDATE projects SET name = ?, color = ?, monthly_budget_pm = ?, updated_at = ?, updated_by_device_id = ?, revision = revision + 1 WHERE id = ?',
            [p.name, p.color, p.monthlyBudget ?? null, now, dev, id],
          );
        }
      }
      for (const [id] of prevProjMap) {
        if (!nextProjMap.has(id)) {
          await db.execute(
            'UPDATE projects SET deleted_at = ?, updated_at = ?, updated_by_device_id = ?, revision = revision + 1 WHERE id = ? AND deleted_at IS NULL',
            [now, now, dev, id],
          );
        }
      }

      // project_budget_overrides
      const prevOv = new Map<string, { projectId: string; ym: string; hours: number }>();
      const nextOv = new Map<string, { projectId: string; ym: string; hours: number }>();
      for (const p of prev.projects) {
        if (p.monthlyBudgetOverrides) {
          for (const [ym, hours] of Object.entries(p.monthlyBudgetOverrides)) {
            prevOv.set(`${p.id}|${ym}`, { projectId: p.id, ym, hours });
          }
        }
      }
      for (const p of filtered.projects) {
        if (p.monthlyBudgetOverrides) {
          for (const [ym, hours] of Object.entries(p.monthlyBudgetOverrides)) {
            nextOv.set(`${p.id}|${ym}`, { projectId: p.id, ym, hours });
          }
        }
      }
      for (const [k, ov] of nextOv) {
        const old = prevOv.get(k);
        if (old === undefined) {
          await db.execute(
            'INSERT INTO project_budget_overrides (project_id, ym, hours, created_at, updated_at, created_by_device_id, updated_by_device_id, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(project_id, ym) DO UPDATE SET hours = excluded.hours, deleted_at = NULL, updated_at = excluded.updated_at, updated_by_device_id = excluded.updated_by_device_id, revision = project_budget_overrides.revision + 1',
            [ov.projectId, ov.ym, ov.hours, now, now, dev, dev],
          );
        } else if (old.hours !== ov.hours) {
          await db.execute(
            'UPDATE project_budget_overrides SET hours = ?, updated_at = ?, updated_by_device_id = ?, revision = revision + 1 WHERE project_id = ? AND ym = ?',
            [ov.hours, now, dev, ov.projectId, ov.ym],
          );
        }
      }
      for (const [k, ov] of prevOv) {
        if (!nextOv.has(k)) {
          await db.execute(
            'UPDATE project_budget_overrides SET deleted_at = ?, updated_at = ?, updated_by_device_id = ?, revision = revision + 1 WHERE project_id = ? AND ym = ? AND deleted_at IS NULL',
            [now, now, dev, ov.projectId, ov.ym],
          );
        }
      }

      // templates
      const prevTplMap = new Map(prev.templates.map((t) => [t.id, t]));
      const nextTplMap = new Map(filtered.templates.map((t) => [t.id, t]));
      for (const [id, t] of nextTplMap) {
        const old = prevTplMap.get(id);
        if (old === undefined) {
          await db.execute(
            'INSERT INTO templates (id, label, color, project_id, default_duration_min, created_at, updated_at, created_by_device_id, updated_by_device_id, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET label = excluded.label, color = excluded.color, project_id = excluded.project_id, default_duration_min = excluded.default_duration_min, deleted_at = NULL, updated_at = excluded.updated_at, updated_by_device_id = excluded.updated_by_device_id, revision = templates.revision + 1',
            [id, t.label, t.color ?? null, t.projectId ?? null, t.defaultDurationMin, now, now, dev, dev],
          );
        } else if (old.label !== t.label || old.color !== t.color || old.projectId !== t.projectId || old.defaultDurationMin !== t.defaultDurationMin) {
          await db.execute(
            'UPDATE templates SET label = ?, color = ?, project_id = ?, default_duration_min = ?, updated_at = ?, updated_by_device_id = ?, revision = revision + 1 WHERE id = ?',
            [t.label, t.color ?? null, t.projectId ?? null, t.defaultDurationMin, now, dev, id],
          );
        }
      }
      for (const [id] of prevTplMap) {
        if (!nextTplMap.has(id)) {
          await db.execute(
            'UPDATE templates SET deleted_at = ?, updated_at = ?, updated_by_device_id = ?, revision = revision + 1 WHERE id = ? AND deleted_at IS NULL',
            [now, now, dev, id],
          );
        }
      }

      // blocks (native only — gcal blocks are stripped in `filtered`)
      const prevBlocks = new Map<string, TimeBlock & { date: DateString }>();
      const nextBlocks = new Map<string, TimeBlock & { date: DateString }>();
      for (const [date, list] of Object.entries(prev.blocksByDate)) {
        for (const b of list) prevBlocks.set(b.id, { ...b, date });
      }
      for (const [date, list] of Object.entries(filtered.blocksByDate)) {
        for (const b of list) nextBlocks.set(b.id, { ...b, date });
      }
      for (const [id, b] of nextBlocks) {
        const old = prevBlocks.get(id);
        if (old === undefined) {
          await db.execute(
            'INSERT INTO blocks (id, date, start_min, duration_min, label, project_id, template_id, source, gcal_key, notify_offset_min, created_at, updated_at, created_by_device_id, updated_by_device_id, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET date = excluded.date, start_min = excluded.start_min, duration_min = excluded.duration_min, label = excluded.label, project_id = excluded.project_id, template_id = excluded.template_id, source = excluded.source, gcal_key = excluded.gcal_key, notify_offset_min = excluded.notify_offset_min, deleted_at = NULL, updated_at = excluded.updated_at, updated_by_device_id = excluded.updated_by_device_id, revision = blocks.revision + 1',
            [id, b.date, b.start, b.durationMin, b.label, b.projectId ?? null, b.templateId ?? null, b.source ?? null, b.gcalKey ?? null, b.notifyOffsetMin ?? null, now, now, dev, dev],
          );
        } else if (
          old.date !== b.date ||
          old.start !== b.start ||
          old.durationMin !== b.durationMin ||
          old.label !== b.label ||
          old.projectId !== b.projectId ||
          old.templateId !== b.templateId ||
          old.notifyOffsetMin !== b.notifyOffsetMin
        ) {
          await db.execute(
            'UPDATE blocks SET date = ?, start_min = ?, duration_min = ?, label = ?, project_id = ?, template_id = ?, notify_offset_min = ?, updated_at = ?, updated_by_device_id = ?, revision = revision + 1 WHERE id = ?',
            [b.date, b.start, b.durationMin, b.label, b.projectId ?? null, b.templateId ?? null, b.notifyOffsetMin ?? null, now, dev, id],
          );
        }
      }
      for (const [id] of prevBlocks) {
        if (!nextBlocks.has(id)) {
          await db.execute(
            'UPDATE blocks SET deleted_at = ?, updated_at = ?, updated_by_device_id = ?, revision = revision + 1 WHERE id = ? AND deleted_at IS NULL',
            [now, now, dev, id],
          );
        }
      }

      // gcal_assignments
      const prevGaKeys = new Set(Object.keys(prev.gcalAssignments));
      const nextGaKeys = new Set(Object.keys(filtered.gcalAssignments));
      for (const k of nextGaKeys) {
        const oldA = prev.gcalAssignments[k];
        const newA = filtered.gcalAssignments[k];
        if (newA === undefined) continue;
        if (oldA === undefined) {
          await db.execute(
            'INSERT INTO gcal_assignments (gcal_key, project_id, hidden, summary, created_at, updated_at, created_by_device_id, updated_by_device_id, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(gcal_key) DO UPDATE SET project_id = excluded.project_id, hidden = excluded.hidden, summary = excluded.summary, deleted_at = NULL, updated_at = excluded.updated_at, updated_by_device_id = excluded.updated_by_device_id, revision = gcal_assignments.revision + 1',
            [k, newA.projectId ?? null, newA.hidden === true ? 1 : 0, newA.summary ?? null, now, now, dev, dev],
          );
        } else if (oldA.projectId !== newA.projectId || oldA.hidden !== newA.hidden || oldA.summary !== newA.summary) {
          await db.execute(
            'UPDATE gcal_assignments SET project_id = ?, hidden = ?, summary = ?, updated_at = ?, updated_by_device_id = ?, revision = revision + 1 WHERE gcal_key = ?',
            [newA.projectId ?? null, newA.hidden === true ? 1 : 0, newA.summary ?? null, now, dev, k],
          );
        }
      }
      for (const k of prevGaKeys) {
        if (!nextGaKeys.has(k)) {
          await db.execute(
            'UPDATE gcal_assignments SET deleted_at = ?, updated_at = ?, updated_by_device_id = ?, revision = revision + 1 WHERE gcal_key = ? AND deleted_at IS NULL',
            [now, now, dev, k],
          );
        }
      }

      // gcal_summary_rules
      const prevGsKeys = new Set(Object.keys(prev.gcalSummaryRules));
      const nextGsKeys = new Set(Object.keys(filtered.gcalSummaryRules));
      for (const k of nextGsKeys) {
        const oldR = prev.gcalSummaryRules[k];
        const newR = filtered.gcalSummaryRules[k];
        if (newR === undefined) continue;
        if (oldR === undefined) {
          await db.execute(
            'INSERT INTO gcal_summary_rules (summary, project_id, hidden, created_at, updated_at, created_by_device_id, updated_by_device_id, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(summary) DO UPDATE SET project_id = excluded.project_id, hidden = excluded.hidden, deleted_at = NULL, updated_at = excluded.updated_at, updated_by_device_id = excluded.updated_by_device_id, revision = gcal_summary_rules.revision + 1',
            [k, newR.projectId ?? null, newR.hidden === true ? 1 : 0, now, now, dev, dev],
          );
        } else if (oldR.projectId !== newR.projectId || oldR.hidden !== newR.hidden) {
          await db.execute(
            'UPDATE gcal_summary_rules SET project_id = ?, hidden = ?, updated_at = ?, updated_by_device_id = ?, revision = revision + 1 WHERE summary = ?',
            [newR.projectId ?? null, newR.hidden === true ? 1 : 0, now, dev, k],
          );
        }
      }
      for (const k of prevGsKeys) {
        if (!nextGsKeys.has(k)) {
          await db.execute(
            'UPDATE gcal_summary_rules SET deleted_at = ?, updated_at = ?, updated_by_device_id = ?, revision = revision + 1 WHERE summary = ? AND deleted_at IS NULL',
            [now, now, dev, k],
          );
        }
      }

      this.cachedState = filtered;
    }
  }

  async importStoredJson(raw: string): Promise<StoredState> {
    const parsed: unknown = JSON.parse(raw);
    const state = parseStoredPayload(parsed);
    if (state === null) throw new Error('Invalid taskette JSON payload');
    await this.save(state);
    return state;
  }

  async loadGcalEvents(calendarId: string): Promise<readonly GcalEventRecord[]> {
    const db = await this.getDb();
    const rows = await db.select<{
      calendar_id: string;
      event_id: string;
      summary: string;
      start_ms: number;
      end_ms: number;
      is_recurring: number;
      recurring_event_id: string | null;
      html_link: string | null;
    }[]>(
      'SELECT calendar_id, event_id, summary, start_ms, end_ms, is_recurring, recurring_event_id, html_link FROM gcal_events WHERE calendar_id = ? AND tombstone = 0',
      [calendarId],
    );
    return rows.map((r) => ({
      calendarId: r.calendar_id,
      eventId: r.event_id,
      summary: r.summary,
      startMs: r.start_ms,
      endMs: r.end_ms,
      isRecurring: r.is_recurring === 1,
      recurringEventId: r.recurring_event_id,
      htmlLink: r.html_link,
    }));
  }

  async applyGcalSyncRun(args: GcalSyncRunInput): Promise<void> {
    const db = await this.getDb();
    const now = Date.now();
    // UPSERT each event; revives tombstoned rows by clearing tombstone and bumping revision.
    for (const e of args.events) {
      await db.execute(
        'INSERT INTO gcal_events (calendar_id, event_id, summary, start_ms, end_ms, is_recurring, recurring_event_id, html_link, last_seen_at, sync_run_id, tombstone, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?) ON CONFLICT(calendar_id, event_id) DO UPDATE SET summary = excluded.summary, start_ms = excluded.start_ms, end_ms = excluded.end_ms, is_recurring = excluded.is_recurring, recurring_event_id = excluded.recurring_event_id, html_link = excluded.html_link, last_seen_at = excluded.last_seen_at, sync_run_id = excluded.sync_run_id, tombstone = 0, revision = gcal_events.revision + 1, updated_at = excluded.updated_at',
        [
          e.calendarId,
          e.eventId,
          e.summary,
          e.startMs,
          e.endMs,
          e.isRecurring ? 1 : 0,
          e.recurringEventId,
          e.htmlLink,
          args.runStartedAt,
          args.syncRunId,
          now,
        ],
      );
    }
    // Tombstone window-intersecting active rows that were NOT seen in this run.
    // Window intersection: start_ms < timeMax AND end_ms > timeMin.
    await db.execute(
      'UPDATE gcal_events SET tombstone = 1, revision = revision + 1, updated_at = ? WHERE calendar_id = ? AND tombstone = 0 AND last_seen_at < ? AND start_ms < ? AND end_ms > ?',
      [now, args.calendarId, args.runStartedAt, args.timeMaxMs, args.timeMinMs],
    );
  }

  async clearGcalEvents(calendarId: string): Promise<void> {
    const db = await this.getDb();
    await db.execute('DELETE FROM gcal_events WHERE calendar_id = ?', [calendarId]);
  }
}

const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let backendInstance: StorageBackend | null = null;
const getBackend = (): StorageBackend => {
  if (backendInstance === null) {
    backendInstance = isTauri() ? new SqliteBackend() : new LocalStorageBackend();
  }
  return backendInstance;
};

export const loadStore = (): Promise<StoredState> => getBackend().load();

export const saveStore = (state: StoredState): Promise<void> => getBackend().save(state);

export const importStoreFromJson = (raw: string): Promise<StoredState> =>
  getBackend().importStoredJson(raw);

export const loadGcalEventsFromStore = (calendarId: string): Promise<readonly GcalEventRecord[]> =>
  getBackend().loadGcalEvents(calendarId);

export const applyGcalSyncRunToStore = (args: GcalSyncRunInput): Promise<void> =>
  getBackend().applyGcalSyncRun(args);

export const clearGcalEventsFromStore = (calendarId: string): Promise<void> =>
  getBackend().clearGcalEvents(calendarId);

export const isUsingTauriBackend = (): boolean => isTauri();
