/**
 * Slice 22-C3: Settings panel for Drive snapshot sync.
 *
 * Renders the on/off toggle, status indicator, manual sync button, and
 * diagnostic smoke-test button. The actual orchestration logic lives in
 * {@link useDriveSync}; this component only marshals state into copy.
 */

import type { JSX } from 'react';
import { Cloud, Loader2, RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react';
import type { UseDriveSync, DriveSyncStatus } from '../sync/useDriveSync.js';
import { Button } from './ui/button.js';

type Props = {
  readonly sync: UseDriveSync;
};

const statusText = (s: DriveSyncStatus): string => {
  switch (s.kind) {
    case 'unsupported':
      return 'デスクトップ版でのみ利用できます';
    case 'loading':
      return '設定を読み込み中…';
    case 'disabled':
      return '無効';
    case 'no-token':
      return 'Google 連携が解除されています。Calendar を再接続してください';
    case 'idle':
      return '待機中';
    case 'syncing':
      return '同期中…';
    case 'enabling':
      return 'Drive 権限を取得中…';
    case 'smoke-testing':
      return '接続テスト中…';
    case 'smoke-failed':
      return 'Drive の楽観的ロックが期待通りに動作しませんでした';
    case 'error':
      return s.message;
  }
};

const relativeTime = (ms: number | null): string => {
  if (ms === null) return '未同期';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'たった今';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 時間前`;
  return `${Math.floor(diff / 86_400_000)} 日前`;
};

const StatusBadge = ({ status }: { status: DriveSyncStatus }): JSX.Element => {
  let color = '#A39A92';
  let Icon = Cloud;
  switch (status.kind) {
    case 'idle':
      color = '#7FA384';
      Icon = ShieldCheck;
      break;
    case 'syncing':
    case 'enabling':
    case 'smoke-testing':
      color = '#C29050';
      Icon = Loader2;
      break;
    case 'error':
    case 'smoke-failed':
      color = '#B85C5C';
      Icon = ShieldAlert;
      break;
    case 'no-token':
      color = '#A8783D';
      Icon = ShieldAlert;
      break;
    default:
      break;
  }
  const spinning =
    status.kind === 'syncing' ||
    status.kind === 'enabling' ||
    status.kind === 'smoke-testing';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-medium"
      style={{ color }}
    >
      <Icon className={`size-3 ${spinning ? 'animate-spin' : ''}`} />
      {statusText(status)}
    </span>
  );
};

export const DriveSyncPanel = ({ sync }: Props): JSX.Element => {
  if (sync.status.kind === 'unsupported') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Drive 同期はデスクトップ版でのみ利用できます。Tauri ビルドからお試しください。
        </p>
      </div>
    );
  }

  const isEnabled = sync.enabled;
  const isBusy =
    sync.status.kind === 'syncing' ||
    sync.status.kind === 'enabling' ||
    sync.status.kind === 'smoke-testing';

  const onToggle = (): void => {
    if (isEnabled) {
      void sync.disable();
    } else {
      void sync.enable();
    }
  };

  const lastResultText = ((): string | null => {
    if (sync.lastResult === null) return null;
    switch (sync.lastResult.kind) {
      case 'pushed':
        return sync.lastResult.conflicts === 0
          ? `世代 ${sync.lastResult.newGeneration} を公開しました`
          : `世代 ${sync.lastResult.newGeneration} を公開（競合 ${sync.lastResult.conflicts} 件）`;
      case 'duplicate-detected':
        return '同期ファイルが重複しています。手動で整理が必要です';
      case 'schema-refused':
        return '別端末のスキーマが新しすぎます。本端末を更新してください';
      case 'corrupt-envelope':
        return `Drive 上の snapshot が破損しています (dropped=${sync.lastResult.droppedRows}, sha256=${sync.lastResult.sha256Matches})`;
      case 'cas-exhausted':
        return `${sync.lastResult.attempts} 回の楽観的ロック失敗で打ち切りました`;
      case 'error':
        return sync.lastResult.message;
    }
  })();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[12px] text-muted-foreground leading-relaxed mb-4">
          Drive の非表示領域 (appDataFolder) を経由してブロック・案件・テンプレートなどを複数デバイス間で同期します。
          有効化時に Google で Drive 権限の確認画面が一度表示されます。
        </p>

        <div className="flex items-center justify-between gap-3 px-3.5 py-3 bg-card border border-border rounded-md">
          <div className="flex flex-col gap-1">
            <div className="text-[13px] font-semibold flex items-center gap-2">
              <Cloud className="size-3.5" /> Drive 同期
            </div>
            <StatusBadge status={sync.status} />
          </div>
          <Button
            size="sm"
            variant={isEnabled ? 'outline' : 'default'}
            disabled={isBusy}
            onClick={onToggle}
          >
            {isEnabled ? '無効化' : '有効化'}
          </Button>
        </div>
      </div>

      {isEnabled && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <div className="text-[12px] font-medium">最後の同期</div>
              <div className="text-[11px] text-muted-foreground">
                {relativeTime(sync.lastSyncedAt)}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={isBusy || sync.status.kind === 'no-token'}
              onClick={() => {
                void sync.runSync();
              }}
            >
              <RefreshCw className={`size-3 mr-1.5 ${isBusy ? 'animate-spin' : ''}`} />
              今すぐ同期
            </Button>
          </div>

          {lastResultText !== null && (
            <div className="text-[11px] text-foreground bg-muted/30 rounded-md px-3 py-2">
              {lastResultText}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-border pt-4">
        <div className="text-[12px] font-medium mb-2">診断</div>
        <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">
          Drive API の楽観的ロック挙動を実機テストします。Drive 上に小さなテストファイルを一時的に作成・削除します。
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={isBusy}
          onClick={() => {
            void sync.runSmokeTest();
          }}
        >
          接続テストを実行
        </Button>
        {sync.status.kind === 'smoke-failed' && (
          <div className="mt-3 text-[11px] bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2 text-foreground">
            <div className="font-semibold mb-1 text-destructive">
              CAS (世代カウンタ) が期待通り動作しませんでした
            </div>
            <ul className="space-y-0.5 list-disc list-inside text-foreground/85">
              {sync.status.report.messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
