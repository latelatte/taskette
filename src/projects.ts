import type { Project } from './domain/types.js';

/**
 * Nuance palette — OKLCH ベースで知覚輝度 L≈0.65、彩度 C≈0.075 に統一。
 * ダスティローズ primary (--primary, oklch(0.665 0.080 10)) と同じ系列で
 * Linear/Apple ライクな上品さを保ちつつ案件区別が利く 8 色。
 * hex は近似値（OKLCH を sRGB に変換したもの）。
 */
export const PROJECT_COLOR_PALETTE: readonly string[] = [
  '#C18B9C', // dusty rose-pink (H≈10)
  '#C19584', // dusty terracotta (H≈40)
  '#B89E76', // golden ochre (H≈80)
  '#94B395', // sage green (H≈140)
  '#83AEB4', // dusty teal (H≈190)
  '#94A6BD', // dusty blue (H≈240)
  '#AB9CC4', // dusty lavender (H≈280)
  '#BC9CB0', // mauve (H≈330)
];

export const DEFAULT_PROJECTS: readonly Project[] = [
  { id: 'p-a', name: 'A案件', color: '#94A6BD' },
  { id: 'p-b', name: 'B案件', color: '#C18B9C' },
  { id: 'p-internal', name: '内部業務', color: '#A39A92' },
];
