import type { TaskTemplate } from './domain/types.js';

export const DEFAULT_TEMPLATES: readonly TaskTemplate[] = [
  { id: 't1', label: '☕ コーヒー', defaultDurationMin: 15, color: '#A39A92', projectId: 'p-internal' },
  { id: 't2', label: '💻 集中作業 (A)', defaultDurationMin: 90, color: '#94A6BD', projectId: 'p-a' },
  { id: 't3', label: '🍱 ランチ', defaultDurationMin: 60, color: '#B89E76', projectId: 'p-internal' },
  { id: 't4', label: '🏃 運動', defaultDurationMin: 30, color: '#94B395', projectId: 'p-internal' },
  { id: 't5', label: '📚 読書', defaultDurationMin: 45, color: '#AB9CC4', projectId: 'p-internal' },
  { id: 't6', label: '🤝 打合せ (B)', defaultDurationMin: 30, color: '#C18B9C', projectId: 'p-b' },
];
