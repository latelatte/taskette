import type { TaskTemplate } from './domain/types.js';

export const SAMPLE_TEMPLATES: readonly TaskTemplate[] = [
  { id: 't1', label: '☕ コーヒー', defaultDurationMin: 15, color: '#8B5A2B' },
  { id: 't2', label: '💻 集中作業', defaultDurationMin: 90, color: '#2563eb' },
  { id: 't3', label: '🍱 ランチ', defaultDurationMin: 60, color: '#f59e0b' },
  { id: 't4', label: '🏃 運動', defaultDurationMin: 30, color: '#10b981' },
  { id: 't5', label: '📚 読書', defaultDurationMin: 45, color: '#a855f7' },
  { id: 't6', label: '🛌 休憩', defaultDurationMin: 20, color: '#64748b' },
];
