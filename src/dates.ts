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
