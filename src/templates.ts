import type { TaskTemplate } from './domain/types.js';

export const DEFAULT_TEMPLATES: readonly TaskTemplate[] = [
  { id: 't1', label: '☕ コーヒー', defaultDurationMin: 15, color: '#8B5A2B', projectId: 'p-internal' },
  { id: 't2', label: '💻 集中作業 (A)', defaultDurationMin: 90, color: '#2563eb', projectId: 'p-a' },
  { id: 't3', label: '🍱 ランチ', defaultDurationMin: 60, color: '#f59e0b', projectId: 'p-internal' },
  { id: 't4', label: '🏃 運動', defaultDurationMin: 30, color: '#10b981', projectId: 'p-internal' },
  { id: 't5', label: '📚 読書', defaultDurationMin: 45, color: '#a855f7', projectId: 'p-internal' },
  { id: 't6', label: '🤝 打合せ (B)', defaultDurationMin: 30, color: '#dc2626', projectId: 'p-b' },
];
