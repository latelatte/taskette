import type { DateString } from './domain/types.js';

const DAY_NAMES_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

const pad2 = (n: number): string => n.toString().padStart(2, '0');

export const formatDate = (d: Date): DateString => {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export const parseDate = (s: DateString): Date => {
  const parts = s.split('-');
  return new Date(
    parseInt(parts[0] ?? '1970', 10),
    parseInt(parts[1] ?? '1', 10) - 1,
    parseInt(parts[2] ?? '1', 10),
  );
};

export const today = (): DateString => formatDate(new Date());

export const addDays = (s: DateString, n: number): DateString => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return formatDate(d);
};

export const formatJaDate = (s: DateString): string => {
  const d = parseDate(s);
  const dayName = DAY_NAMES_JA[d.getDay()] ?? '?';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 (${dayName})`;
};

export const yearMonthOf = (s: DateString): string => s.slice(0, 7);

export const formatJaYearMonth = (yearMonth: string): string => {
  const [y, m] = yearMonth.split('-');
  return `${y}年${parseInt(m ?? '1', 10)}月`;
};

export const daysInMonth = (yearMonth: string): number => {
  const parts = yearMonth.split('-');
  const y = parseInt(parts[0] ?? '1970', 10);
  const m = parseInt(parts[1] ?? '1', 10);
  return new Date(y, m, 0).getDate();
};

export const elapsedRatio = (yearMonth: string, todayDate: DateString = today()): number => {
  const todayMonth = yearMonthOf(todayDate);
  if (yearMonth < todayMonth) return 1;
  if (yearMonth > todayMonth) return 0;
  const dayOfMonth = parseInt(todayDate.slice(8, 10), 10);
  return Math.max(0, Math.min(1, dayOfMonth / daysInMonth(yearMonth)));
};

export const weekStart = (s: DateString): DateString => {
  const d = parseDate(s);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return formatDate(d);
};

export const daysOfWeek = (s: DateString): readonly DateString[] => {
  const start = weekStart(s);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
};

export const daysOfMonthGrid = (yearMonth: string): readonly DateString[] => {
  const firstDay = `${yearMonth}-01`;
  const start = weekStart(firstDay);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
};

export const monthsOfYear = (year: string): readonly string[] => {
  return Array.from({ length: 12 }, (_, i) => `${year}-${pad2(i + 1)}`);
};

export const addMonths = (s: DateString, n: number): DateString => {
  const d = parseDate(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return formatDate(d);
};

export const yearOf = (s: DateString): string => s.slice(0, 4);

export const formatJaYear = (year: string): string => `${year}年`;
