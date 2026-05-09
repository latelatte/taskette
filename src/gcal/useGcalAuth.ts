import { useGcalAuthBrowser } from './useGcalAuthBrowser.js';
import { useGcalAuthTauri } from './useGcalAuthTauri.js';

export type GcalAuthStatus =
  | 'unconfigured' // OAuth client ID 未設定
  | 'loading' // 初期化中 (Browser: GIS 読み込み待ち / Tauri: keyring チェック中)
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

const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Hook 実体は環境ごとに別実装。React の Rules of Hooks 上、コンポーネント側からの
// 呼び出しは常に同一参照になるよう module-scope で固定する。
export const useGcalAuth = isTauriRuntime() ? useGcalAuthTauri : useGcalAuthBrowser;
