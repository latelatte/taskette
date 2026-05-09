import type { Project } from './domain/types.js';

export const PROJECT_COLOR_PALETTE: readonly string[] = [
  '#2563eb', // blue
  '#dc2626', // red
  '#16a34a', // green
  '#f59e0b', // amber
  '#a855f7', // purple
  '#0891b2', // cyan
  '#db2777', // pink
  '#64748b', // slate
];

export const DEFAULT_PROJECTS: readonly Project[] = [
  { id: 'p-a', name: 'A案件', color: '#2563eb' },
  { id: 'p-b', name: 'B案件', color: '#dc2626' },
  { id: 'p-internal', name: '内部業務', color: '#64748b' },
];
