/**
 * 通知音の設定。
 * - 'silent': 音なし
 * - 'system': macOS の標準通知音 (plugin の sound: 'default' 経由)
 * - 'custom': public/sounds/ 配下のファイルを HTML5 Audio で再生
 *
 * 自前の音を追加する場合は、ファイルを public/sounds/ に置いて、
 * 下の SOUNDS 配列に { id, kind: 'custom', label, url } を追記してください。
 */

export type NotificationSound =
  | { readonly id: string; readonly kind: 'silent'; readonly label: string }
  | { readonly id: string; readonly kind: 'system'; readonly label: string }
  | { readonly id: string; readonly kind: 'custom'; readonly label: string; readonly url: string };

export const SOUNDS: readonly NotificationSound[] = [
  { id: 'silent', kind: 'silent', label: '通知音なし' },
  { id: 'system', kind: 'system', label: 'システム標準' },
  // ここから下にカスタム音を追加できます (public/sounds/ にファイルを置いてから):
  { id: 'kapom', kind: 'custom', label: 'Kapom', url: '/sounds/kapom.mp3' },
  { id: 'kiriri', kind: 'custom', label: 'Kiriri', url: '/sounds/kiriri.mp3' },
  { id: 'kyupi', kind: 'custom', label: 'Kyupi', url: '/sounds/kyupi.mp3' },
  { id: 'pikon', kind: 'custom', label: 'Pikon', url: '/sounds/pikon.mp3' },
  { id: 'poyo', kind: 'custom', label: 'Poyo', url: '/sounds/poyo.mp3' },
];

export const DEFAULT_SOUND_ID = 'system';

export const findSound = (id: string): NotificationSound => {
  return SOUNDS.find((s) => s.id === id) ?? SOUNDS[0]!;
};

export const NOTIFICATION_SOUND_KEY = 'taskette/notification-sound-id';

/** localStorage から現在の選択 ID を取得。未設定ならデフォルト。 */
export const loadSelectedSoundId = (): string => {
  if (typeof localStorage === 'undefined') return DEFAULT_SOUND_ID;
  const v = localStorage.getItem(NOTIFICATION_SOUND_KEY);
  if (v === null) return DEFAULT_SOUND_ID;
  return findSound(v).id;
};

export const saveSelectedSoundId = (id: string): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(NOTIFICATION_SOUND_KEY, id);
};
