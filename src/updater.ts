import { useCallback, useEffect, useRef, useState } from 'react';
import { check, type Update, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { isUsingTauriBackend } from './storage.js';

export type UpdateInfo = {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
};

export type UpdaterStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; update: UpdateInfo }
  | { kind: 'downloading'; update: UpdateInfo; downloaded: number; total: number | null }
  | { kind: 'ready'; update: UpdateInfo }
  | { kind: 'error'; message: string };

const toInfo = (u: Update): UpdateInfo => ({
  version: u.version,
  currentVersion: u.currentVersion,
  notes: u.body ?? null,
  date: u.date ?? null,
});

let cachedAppVersion: string | null = null;

export type UseUpdater = {
  status: UpdaterStatus;
  appVersion: string | null;
  isSupported: boolean;
  hasUpdate: boolean;
  check: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  relaunchNow: () => Promise<void>;
  dismiss: () => void;
};

export const useUpdater = (autoCheck = true): UseUpdater => {
  const isSupported = isUsingTauriBackend();
  const [status, setStatus] = useState<UpdaterStatus>({ kind: 'idle' });
  const [appVersion, setAppVersion] = useState<string | null>(cachedAppVersion);
  const updateRef = useRef<Update | null>(null);
  const didAutoCheckRef = useRef(false);

  useEffect(() => {
    if (!isSupported) return;
    if (cachedAppVersion) return;
    let cancelled = false;
    void getVersion()
      .then((v) => {
        cachedAppVersion = v;
        if (!cancelled) setAppVersion(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isSupported]);

  const doCheck = useCallback(async (): Promise<void> => {
    if (!isSupported) return;
    setStatus({ kind: 'checking' });
    try {
      const result = await check();
      if (result) {
        updateRef.current = result;
        setStatus({ kind: 'available', update: toInfo(result) });
      } else {
        updateRef.current = null;
        setStatus({ kind: 'up-to-date' });
      }
    } catch (err) {
      setStatus({ kind: 'error', message: errorMessage(err) });
    }
  }, [isSupported]);

  const downloadAndInstall = useCallback(async (): Promise<void> => {
    const update = updateRef.current;
    if (!update) return;
    const info = toInfo(update);
    let downloaded = 0;
    let total: number | null = null;
    setStatus({ kind: 'downloading', update: info, downloaded: 0, total: null });
    try {
      await update.downloadAndInstall((evt: DownloadEvent) => {
        if (evt.event === 'Started') {
          total = typeof evt.data.contentLength === 'number' ? evt.data.contentLength : null;
          setStatus({ kind: 'downloading', update: info, downloaded: 0, total });
        } else if (evt.event === 'Progress') {
          downloaded += evt.data.chunkLength;
          setStatus({ kind: 'downloading', update: info, downloaded, total });
        } else if (evt.event === 'Finished') {
          setStatus({ kind: 'ready', update: info });
        }
      });
      setStatus({ kind: 'ready', update: info });
    } catch (err) {
      setStatus({ kind: 'error', message: errorMessage(err) });
    }
  }, []);

  const relaunchNow = useCallback(async (): Promise<void> => {
    try {
      await relaunch();
    } catch (err) {
      setStatus({ kind: 'error', message: errorMessage(err) });
    }
  }, []);

  const dismiss = useCallback((): void => {
    updateRef.current = null;
    setStatus({ kind: 'idle' });
  }, []);

  useEffect(() => {
    if (!autoCheck) return;
    if (!isSupported) return;
    if (didAutoCheckRef.current) return;
    didAutoCheckRef.current = true;
    void doCheck();
  }, [autoCheck, isSupported, doCheck]);

  const hasUpdate = status.kind === 'available' || status.kind === 'ready';

  return {
    status,
    appVersion,
    isSupported,
    hasUpdate,
    check: doCheck,
    downloadAndInstall,
    relaunchNow,
    dismiss,
  };
};

const errorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return '更新の確認に失敗しました';
  }
};

export const formatProgress = (downloaded: number, total: number | null): string => {
  if (total == null || total <= 0) {
    return `${(downloaded / 1024 / 1024).toFixed(1)} MB`;
  }
  const pct = Math.min(100, Math.round((downloaded / total) * 100));
  return `${pct}%  (${(downloaded / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB)`;
};
