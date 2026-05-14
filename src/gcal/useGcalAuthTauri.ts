import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { GcalAuthStatus, UseGcalAuth } from './useGcalAuth.js';

const PROACTIVE_REFRESH_BUFFER_MS = 5 * 60_000; // refresh 5 min before expiry
const PROACTIVE_REFRESH_MIN_MS = 60_000;

type OAuthTokens = {
  access_token: string;
  expires_at: number; // Unix epoch seconds
  granted_scopes: string[]; // populated since Slice 22-B; pre-22-B builds return []
};

export const useGcalAuthTauri = (): UseGcalAuth => {
  const clientId = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID as string | undefined;
  const clientSecret = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET as string | undefined;
  const [status, setStatus] = useState<GcalAuthStatus>(
    clientId === undefined || clientId.length === 0 ? 'unconfigured' : 'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const refreshInFlight = useRef<Promise<string | null> | null>(null);

  const clearTimer = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const doSilentRefresh = useCallback((): Promise<string | null> => {
    if (refreshInFlight.current !== null) return refreshInFlight.current;
    if (clientId === undefined || clientId.length === 0) return Promise.resolve(null);

    const p = (async (): Promise<string | null> => {
      try {
        const result = await invoke<OAuthTokens | null>('gcal_oauth_silent_refresh', { clientId, clientSecret });
        if (result === null) {
          setToken(null);
          setStatus('disconnected');
          clearTimer();
          return null;
        }
        setToken(result.access_token);
        setStatus('connected');
        setErrorMessage(null);
        scheduleProactiveRefresh(result.expires_at);
        return result.access_token;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErrorMessage(msg);
        setStatus('error');
        return null;
      } finally {
        refreshInFlight.current = null;
      }
    })();

    refreshInFlight.current = p;
    return p;

    function scheduleProactiveRefresh(expiresAtSec: number): void {
      clearTimer();
      const ms = Math.max(
        PROACTIVE_REFRESH_MIN_MS,
        expiresAtSec * 1000 - Date.now() - PROACTIVE_REFRESH_BUFFER_MS,
      );
      refreshTimerRef.current = window.setTimeout(() => {
        void doSilentRefresh();
      }, ms);
    }
  }, [clientId, clearTimer]);

  // Initial: check keychain → silent refresh or disconnected
  useEffect(() => {
    if (clientId === undefined || clientId.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const has = await invoke<boolean>('gcal_oauth_has_refresh_token');
        if (cancelled) return;
        if (has) {
          await doSilentRefresh();
        } else {
          setStatus('disconnected');
        }
      } catch (e) {
        if (cancelled) return;
        setStatus('disconnected');
        setErrorMessage(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [clientId, doSilentRefresh, clearTimer]);

  const connect = useCallback(() => {
    if (clientId === undefined || clientId.length === 0) return;
    setStatus('connecting');
    setErrorMessage(null);
    invoke<OAuthTokens>('gcal_oauth_connect', { clientId, clientSecret })
      .then((tokens) => {
        setToken(tokens.access_token);
        setStatus('connected');
        clearTimer();
        const ms = Math.max(
          PROACTIVE_REFRESH_MIN_MS,
          tokens.expires_at * 1000 - Date.now() - PROACTIVE_REFRESH_BUFFER_MS,
        );
        refreshTimerRef.current = window.setTimeout(() => {
          void doSilentRefresh();
        }, ms);
      })
      .catch((e: unknown) => {
        setStatus('error');
        setErrorMessage(e instanceof Error ? e.message : String(e));
      });
  }, [clientId, doSilentRefresh, clearTimer]);

  const disconnect = useCallback(() => {
    setToken(null);
    setStatus('disconnected');
    clearTimer();
    void invoke('gcal_oauth_disconnect').catch(() => {
      // ignore
    });
  }, [clearTimer]);

  const requestSilentRefresh = useCallback((): Promise<string | null> => {
    return doSilentRefresh();
  }, [doSilentRefresh]);

  return {
    status,
    errorMessage,
    clientId,
    accessToken: token,
    connect,
    disconnect,
    requestSilentRefresh,
  };
};
