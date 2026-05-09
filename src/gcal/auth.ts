export const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

type TokenResponse = {
  readonly access_token?: string;
  readonly expires_in?: number;
  readonly error?: string;
  readonly error_description?: string;
};

type TokenClient = {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
};

type GoogleAccountsOauth2 = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (resp: TokenResponse) => void;
    error_callback?: (err: { type: string; message?: string }) => void;
  }) => TokenClient;
  revoke: (accessToken: string, done: () => void) => void;
  hasGrantedAllScopes: (token: TokenResponse, ...scopes: string[]) => boolean;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GoogleAccountsOauth2;
      };
    };
  }
}

let tokenClient: TokenClient | null = null;
let accessToken: string | null = null;
let tokenExpiresAt = 0;
let listeners: Array<(t: string | null) => void> = [];
let errorListeners: Array<(detail: string) => void> = [];

const notify = (token: string | null): void => {
  for (const l of listeners) l(token);
};

const notifyError = (detail: string): void => {
  for (const l of errorListeners) l(detail);
};

export const subscribeToken = (l: (t: string | null) => void): (() => void) => {
  listeners.push(l);
  return () => {
    listeners = listeners.filter((x) => x !== l);
  };
};

export const subscribeAuthError = (l: (detail: string) => void): (() => void) => {
  errorListeners.push(l);
  return () => {
    errorListeners = errorListeners.filter((x) => x !== l);
  };
};

export const isGisLoaded = (): boolean =>
  typeof window !== 'undefined' && window.google?.accounts?.oauth2 !== undefined;

export const initTokenClient = (clientId: string): void => {
  if (!isGisLoaded()) throw new Error('Google Identity Services が読み込まれていません');
  const oauth2 = window.google!.accounts!.oauth2!;
  tokenClient = oauth2.initTokenClient({
    client_id: clientId,
    scope: GCAL_SCOPE,
    callback: (resp) => {
      if (resp.access_token !== undefined && resp.access_token.length > 0) {
        accessToken = resp.access_token;
        const ttlSec = typeof resp.expires_in === 'number' && resp.expires_in > 0 ? resp.expires_in : 3600;
        tokenExpiresAt = Date.now() + ttlSec * 1000;
        notify(accessToken);
      } else {
        accessToken = null;
        tokenExpiresAt = 0;
        const detail = resp.error !== undefined
          ? `${resp.error}${resp.error_description !== undefined ? `: ${resp.error_description}` : ''}`
          : 'access_token が返却されませんでした';
        notifyError(detail);
        notify(null);
      }
    },
    error_callback: (err) => {
      accessToken = null;
      tokenExpiresAt = 0;
      const detail = `${err.type}${err.message !== undefined ? `: ${err.message}` : ''}`;
      notifyError(detail);
      notify(null);
    },
  });
};

export const requestAccessToken = (silent: boolean): void => {
  if (tokenClient === null) throw new Error('Token client が未初期化です');
  tokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' });
};

export const getAccessToken = (): string | null => {
  if (accessToken !== null && Date.now() < tokenExpiresAt - 30_000) return accessToken;
  return null;
};

export const clearToken = (): void => {
  const oauth2 = window.google?.accounts?.oauth2;
  if (accessToken !== null && oauth2 !== undefined) {
    oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  notify(null);
};
