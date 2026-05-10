import type { ProjectEnergy } from './types.js';

export type FocusWindow = {
  readonly start: string; // 'HH:MM'
  readonly end: string;   // 'HH:MM'
  readonly energy: ProjectEnergy;
};

export const DEFAULT_FOCUS_WINDOWS: readonly FocusWindow[] = [
  { start: '09:00', end: '12:00', energy: 'high' },
  { start: '13:00', end: '15:00', energy: 'mid' },
  { start: '15:00', end: '18:00', energy: 'low' },
];

const FOCUS_WINDOWS_KEY = 'taskette/focus-windows';
const TIME_RE = /^\d{2}:\d{2}$/;
const ENERGIES: readonly ProjectEnergy[] = ['low', 'mid', 'high'];

const isFocusWindow = (v: unknown): v is FocusWindow => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.start !== 'string' || !TIME_RE.test(o.start)) return false;
  if (typeof o.end !== 'string' || !TIME_RE.test(o.end)) return false;
  if (typeof o.energy !== 'string' || !ENERGIES.includes(o.energy as ProjectEnergy)) return false;
  return o.start < o.end;
};

export const loadFocusWindows = (): readonly FocusWindow[] => {
  try {
    const raw = localStorage.getItem(FOCUS_WINDOWS_KEY);
    if (raw === null) return DEFAULT_FOCUS_WINDOWS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_FOCUS_WINDOWS;
    const valid = parsed.filter(isFocusWindow);
    return valid.length > 0 ? valid : DEFAULT_FOCUS_WINDOWS;
  } catch {
    return DEFAULT_FOCUS_WINDOWS;
  }
};

export const saveFocusWindows = (windows: readonly FocusWindow[]): void => {
  try {
    localStorage.setItem(FOCUS_WINDOWS_KEY, JSON.stringify(windows));
  } catch {
    // localStorage unavailable / quota exceeded — silently ignore
  }
};
