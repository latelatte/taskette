import type { DateString, Project, TimeBlock } from './domain/types.js';
import { DEFAULT_PROJECTS } from './projects.js';

const STORAGE_KEY = 'taskette/v1';
const SCHEMA_VERSION = 1;
const MINUTES_PER_DAY = 1440;

export type StoredState = {
  blocksByDate: Record<DateString, readonly TimeBlock[]>;
  projects: readonly Project[];
};

const emptyState = (): StoredState => ({
  blocksByDate: {},
  projects: DEFAULT_PROJECTS,
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
  return true;
};

export const loadStore = (): StoredState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return emptyState();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return emptyState();
    const obj = parsed as Record<string, unknown>;

    if (obj.version !== SCHEMA_VERSION) return emptyState();

    const blocksByDate: Record<DateString, readonly TimeBlock[]> = {};
    if (typeof obj.blocksByDate === 'object' && obj.blocksByDate !== null) {
      for (const [date, dayBlocks] of Object.entries(obj.blocksByDate)) {
        if (!Array.isArray(dayBlocks)) continue;
        const valid = dayBlocks.filter(isTimeBlock);
        if (valid.length > 0) blocksByDate[date] = valid;
      }
    }

    const projects: readonly Project[] = Array.isArray(obj.projects)
      ? (obj.projects as readonly Project[])
      : DEFAULT_PROJECTS;

    return { blocksByDate, projects };
  } catch {
    return emptyState();
  }
};

export const saveStore = (state: StoredState): void => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, ...state }),
    );
  } catch {
    // localStorage unavailable or quota exceeded — silently ignore for PoC
  }
};
