import { useEffect } from 'react';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import type { DateString, TimeBlock } from './domain/types.js';
import { findSound, loadSelectedSoundId } from './sounds.js';

const NOTIFY_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const SETTIMEOUT_MAX_MS = 2 ** 31 - 1;

export type NotifyPermission = 'granted' | 'denied' | 'default';

const pad2 = (n: number): string => n.toString().padStart(2, '0');
const formatHHMM = (m: number): string =>
  `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

const blockFireTimeMs = (date: DateString, startMin: number, offsetMin: number): number => {
  const [y, m, d] = date.split('-').map((s) => parseInt(s, 10));
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 0, startMin - offsetMin, 0, 0).getTime();
};

const playCustomSound = (url: string): void => {
  try {
    const audio = new Audio(url);
    void audio.play();
  } catch {
    /* ignore */
  }
};

const fireNotification = async (block: TimeBlock, offsetMin: number): Promise<void> => {
  let granted = false;
  try {
    granted = await isPermissionGranted();
  } catch {
    return;
  }
  if (!granted) return;
  const title =
    offsetMin === 0
      ? `▶︎ ${block.label}`
      : `${offsetMin}分後に開始: ${block.label}`;
  const body = `${formatHHMM(block.start)} 開始`;

  const sound = findSound(loadSelectedSoundId());
  try {
    if (sound.kind === 'system') {
      sendNotification({ title, body, sound: 'default' });
    } else {
      // silent / custom: native の音は出さず、custom は HTML5 Audio で別途再生
      sendNotification({ title, body });
      if (sound.kind === 'custom') playCustomSound(sound.url);
    }
  } catch {
    /* ignore */
  }
};

/** 設定画面の試聴ボタンから呼ばれる。実通知は出さず音だけ確認。 */
export const previewSound = (id: string): void => {
  const sound = findSound(id);
  if (sound.kind === 'custom') {
    playCustomSound(sound.url);
  } else if (sound.kind === 'system') {
    // system は plugin 経由でしか出せないので、軽い実通知でテスト
    void (async () => {
      try {
        const granted = await isPermissionGranted();
        if (!granted) return;
        sendNotification({ title: 'Taskette', body: '通知音テスト', sound: 'default' });
      } catch {
        /* ignore */
      }
    })();
  }
  // silent は何もしない
};

/**
 * 24 時間以内に発火する通知を setTimeout で予約する。
 * blocksByDate が変わるたびに全予約を破棄して再構築。
 */
export const useNotificationScheduler = (
  blocksByDate: Record<DateString, readonly TimeBlock[]>,
): void => {
  useEffect(() => {
    const ids: number[] = [];
    const now = Date.now();

    for (const [date, blocks] of Object.entries(blocksByDate)) {
      for (const block of blocks) {
        if (block.notifyOffsetMin === undefined) continue;
        if (block.source === 'gcal') continue;
        const offset = block.notifyOffsetMin;
        const fireMs = blockFireTimeMs(date, block.start, offset);
        const delay = fireMs - now;
        if (delay <= 0) continue;
        if (delay > NOTIFY_LOOKAHEAD_MS) continue;
        if (delay > SETTIMEOUT_MAX_MS) continue;
        const id = window.setTimeout(() => {
          void fireNotification(block, offset);
        }, delay);
        ids.push(id);
      }
    }

    return () => {
      for (const id of ids) window.clearTimeout(id);
    };
  }, [blocksByDate]);
};

/**
 * 必要なら macOS の通知許可ダイアログを出して、結果を返す。
 * すでに granted なら即時 'granted'。すでに denied なら System 設定が必要。
 */
export const requestNotificationPermission = async (): Promise<NotifyPermission> => {
  try {
    const granted = await isPermissionGranted();
    if (granted) return 'granted';
    return await requestPermission();
  } catch {
    return 'denied';
  }
};

/**
 * 現在の許可状態を非同期で取得 (Tauri plugin は sync API がない)。
 */
export const getNotificationPermission = async (): Promise<NotifyPermission> => {
  try {
    const granted = await isPermissionGranted();
    return granted ? 'granted' : 'default';
  } catch {
    return 'denied';
  }
};
