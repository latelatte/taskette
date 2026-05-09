import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearToken,
  getAccessToken,
  initTokenClient,
  isGisLoaded,
  requestAccessToken,
  subscribeAuthError,
  subscribeToken,
} from './auth.js';

const SILENT_REFRESH_TIMEOUT_MS = 5000;

export type GcalAuthStatus =
  | 'unconfigured' // VITE_GOOGLE_CLIENT_ID 未設定
  | 'loading' // GIS スクリプト読み込み中
  | 'disconnected' // 未接続
  | 'connecting' // 接続フロー中
  | 'connected' // access token 取得済み
  | 'error'; // エラー

export type UseGcalAuth = {
  readonly status: GcalAuthStatus;
  readonly errorMessage: string | null;
  readonly clientId: string | undefined;
  readonly accessToken: string | null;
  readonly connect: () => void;
  readonly disconnect: () => void;
  readonly requestSilentRefresh: () => Promise<string | null>;
};

const GIS_POLL_INTERVAL_MS = 100;
const GIS_POLL_TIMEOUT_MS = 10_000;
const WAS_CONNECTED_KEY = 'taskette/gcal-was-connected';

const readWasConnected = (): boolean => {
  try {
    return localStorage.getItem(WAS_CONNECTED_KEY) === '1';
  } catch {
    return false;
  }
};

const writeWasConnected = (v: boolean): void => {
  try {
    if (v) localStorage.setItem(WAS_CONNECTED_KEY, '1');
    else localStorage.removeItem(WAS_CONNECTED_KEY);
  } catch {
    // ignore
  }
};

export const useGcalAuth = (): UseGcalAuth => {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const [status, setStatus] = useState<GcalAuthStatus>(
    clientId === undefined || clientId.length === 0 ? 'unconfigured' : 'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(getAccessToken());
  const silentInProgress = useRef(false);

  // GIS 読み込み待ち + Token Client 初期化
  useEffect(() => {
    if (clientId === undefined || clientId.length === 0) return;

    let cancelled = false;
    let elapsed = 0;

    const tryInit = (): boolean => {
      if (!isGisLoaded()) return false;
      try {
        initTokenClient(clientId);
        if (cancelled) return true;
        if (getAccessToken() !== null) {
          setStatus('connected');
        } else if (readWasConnected()) {
          // 前回接続済みフラグがあれば silent re-auth を試みる (popup なし)
          setStatus('connecting');
          silentInProgress.current = true;
          try {
            requestAccessToken(true);
          } catch {
            silentInProgress.current = false;
            setStatus('disconnected');
          }
        } else {
          setStatus('disconnected');
        }
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          setErrorMessage(e instanceof Error ? e.message : String(e));
        }
      }
      return true;
    };

    if (tryInit()) return;

    const timer = window.setInterval(() => {
      elapsed += GIS_POLL_INTERVAL_MS;
      if (tryInit()) {
        window.clearInterval(timer);
      } else if (elapsed >= GIS_POLL_TIMEOUT_MS) {
        window.clearInterval(timer);
        if (!cancelled) {
          setStatus('error');
          setErrorMessage('Google Identity Services の読み込みに失敗いたしました');
        }
      }
    }, GIS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [clientId]);

  // token 変化を購読
  useEffect(() => {
    return subscribeToken((t) => {
      setToken(t);
      if (t !== null) {
        silentInProgress.current = false;
        setStatus('connected');
        setErrorMessage(null);
        writeWasConnected(true);
      } else {
        if (silentInProgress.current) {
          // silent attempt 失敗 — 静かに disconnected
          silentInProgress.current = false;
        }
        setStatus('disconnected');
      }
    });
  }, []);

  // GIS からのエラー詳細を購読
  useEffect(() => {
    return subscribeAuthError((detail) => {
      if (silentInProgress.current) {
        // silent attempt のエラーは UI に出さず disconnected に戻すだけ
        silentInProgress.current = false;
        setStatus('disconnected');
        return;
      }
      setStatus('error');
      setErrorMessage(detail);
    });
  }, []);

  const connect = useCallback(() => {
    if (status === 'unconfigured' || status === 'loading') return;
    setStatus('connecting');
    setErrorMessage(null);
    try {
      requestAccessToken(false);
    } catch (e) {
      setStatus('error');
      setErrorMessage(e instanceof Error ? e.message : String(e));
    }
  }, [status]);

  const disconnect = useCallback(() => {
    clearToken();
    writeWasConnected(false);
  }, []);

  // 期限切れ token の silent refresh を試みる Promise API。成功時は新 token、失敗 (popup blocked / session 切れ等) は null。
  const requestSilentRefresh = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      if (clientId === undefined || clientId.length === 0 || !isGisLoaded()) {
        resolve(null);
        return;
      }
      let resolved = false;
      const finish = (result: string | null): void => {
        if (resolved) return;
        resolved = true;
        unsubToken();
        unsubError();
        resolve(result);
      };
      const unsubToken = subscribeToken((t) => {
        if (t !== null) finish(t);
        // t === null は他要因 (disconnect 等) の可能性もあるので待つ
      });
      const unsubError = subscribeAuthError(() => {
        finish(null);
      });
      window.setTimeout(() => finish(null), SILENT_REFRESH_TIMEOUT_MS);
      silentInProgress.current = true;
      try {
        requestAccessToken(true);
      } catch {
        finish(null);
      }
    });
  }, [clientId]);

  return { status, errorMessage, clientId, accessToken: token, connect, disconnect, requestSilentRefresh };
};
