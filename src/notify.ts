/**
 * ブロック通知のオフセット (開始 N 分前) に関する共通ロジック。
 *
 * - 1 つのブロックに複数の通知タイミングを設定できる (例: 1分前と5分前)。
 * - ドメイン上は `notifyOffsetsMin: readonly number[]` で保持。
 * - SQLite には単一列 `notify_offset_min` に CSV ("1,5,10") として格納する
 *   (同期スキーマを変えないため)。単一値は従来どおり整数 1 つとして読める。
 */

const MAX_OFFSET_MIN = 24 * 60;

/** プリセットボタンの定義。value = 開始何分前か。 */
export const NOTIFY_PRESETS: readonly { readonly value: number; readonly label: string }[] = [
  { value: 0, label: '開始時' },
  { value: 1, label: '1分前' },
  { value: 5, label: '5分前' },
  { value: 10, label: '10分前' },
  { value: 15, label: '15分前' },
  { value: 30, label: '30分前' },
  { value: 60, label: '1時間前' },
];

/** 重複除去・範囲外除外・昇順整列した正規化済み配列を返す。 */
export const normalizeNotifyOffsets = (offsets: readonly number[]): number[] => {
  const seen = new Set<number>();
  for (const o of offsets) {
    if (typeof o !== 'number' || !Number.isFinite(o)) continue;
    const n = Math.round(o);
    if (n < 0 || n > MAX_OFFSET_MIN) continue;
    seen.add(n);
  }
  return Array.from(seen).sort((a, b) => a - b);
};

/** SQLite の `notify_offset_min` 値 (number | string | null) を配列へ復元。 */
export const decodeNotifyOffsets = (raw: number | string | null): number[] => {
  if (raw === null) return [];
  if (typeof raw === 'number') return normalizeNotifyOffsets([raw]);
  return normalizeNotifyOffsets(raw.split(',').map((s) => Number(s.trim())));
};

/** 配列を SQLite 格納用の CSV へ。空配列なら null (= 通知なし)。 */
export const encodeNotifyOffsets = (offsets: readonly number[] | undefined): string | null => {
  if (offsets === undefined) return null;
  const norm = normalizeNotifyOffsets(offsets);
  if (norm.length === 0) return null;
  return norm.join(',');
};

/** 2 つのオフセット配列が (正規化後に) 等しいか。永続化の diff 判定で使う。 */
export const notifyOffsetsEqual = (
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
): boolean => {
  const na = normalizeNotifyOffsets(a ?? []);
  const nb = normalizeNotifyOffsets(b ?? []);
  if (na.length !== nb.length) return false;
  return na.every((v, i) => v === nb[i]);
};

const DEFAULT_NOTIFY_KEY = 'taskette/default-notify-offsets';

/** 新規ブロックに適用するデフォルト通知設定を localStorage から取得。未設定なら空 (通知なし)。 */
export const loadDefaultNotifyOffsets = (): number[] => {
  if (typeof localStorage === 'undefined') return [];
  const v = localStorage.getItem(DEFAULT_NOTIFY_KEY);
  if (v === null || v === '') return [];
  return decodeNotifyOffsets(v);
};

export const saveDefaultNotifyOffsets = (offsets: readonly number[]): void => {
  if (typeof localStorage === 'undefined') return;
  const csv = encodeNotifyOffsets(offsets);
  localStorage.setItem(DEFAULT_NOTIFY_KEY, csv ?? '');
};
