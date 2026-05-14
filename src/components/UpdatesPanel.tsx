import { Button } from './ui/button.js';
import { formatProgress, type UseUpdater } from '../updater.js';
import { Download, RefreshCw, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';

type Props = {
  readonly updater: UseUpdater;
};

export function UpdatesPanel({ updater }: Props) {
  const { status, appVersion, isSupported, check, downloadAndInstall, relaunchNow } = updater;

  if (!isSupported) {
    return (
      <div className="text-[13px] text-muted-foreground leading-relaxed">
        ブラウザ環境ではアップデート確認はご利用いただけません。デスクトップ版でお試しください。
      </div>
    );
  }

  const checking = status.kind === 'checking';
  const downloading = status.kind === 'downloading';
  const busy = checking || downloading;

  return (
    <div className="flex flex-col gap-5 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[11px] text-muted-foreground tracking-widest uppercase">現在のバージョン</div>
          <div className="text-[15px] font-semibold mt-0.5">v{appVersion ?? '—'}</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { void check(); }}
          disabled={busy}
        >
          <RefreshCw className={`size-3.5 ${checking ? 'animate-spin' : ''}`} />
          {checking ? '確認中…' : '今すぐ確認'}
        </Button>
      </div>

      {status.kind === 'idle' && (
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          起動時に自動で更新を確認しています。手動で確認するには上のボタンを押してください。
        </p>
      )}

      {status.kind === 'up-to-date' && (
        <div className="flex items-start gap-2 text-[13px] text-muted-foreground">
          <CheckCircle2 className="size-4 mt-0.5 shrink-0 text-emerald-500" />
          <span>お使いのバージョンは最新です。</span>
        </div>
      )}

      {status.kind === 'available' && (
        <div className="rounded-md border border-border bg-card p-3.5 space-y-3">
          <div className="flex items-start gap-2">
            <Sparkles className="size-4 mt-0.5 shrink-0 text-amber-500" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold">
                新しいバージョンが利用可能です: v{status.update.version}
              </div>
              {status.update.date && (
                <div className="text-[11px] text-muted-foreground mt-0.5">{status.update.date}</div>
              )}
            </div>
          </div>
          {status.update.notes && (
            <div className="text-[12px] text-foreground/80 leading-relaxed whitespace-pre-wrap border-l-2 border-border pl-3">
              {status.update.notes}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => { void downloadAndInstall(); }}
            >
              <Download className="size-3.5" />
              ダウンロードして再起動
            </Button>
          </div>
        </div>
      )}

      {status.kind === 'downloading' && (
        <div className="rounded-md border border-border bg-card p-3.5 space-y-2">
          <div className="text-[13px] font-semibold">
            v{status.update.version} をダウンロード中…
          </div>
          <ProgressBar downloaded={status.downloaded} total={status.total} />
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {formatProgress(status.downloaded, status.total)}
          </div>
        </div>
      )}

      {status.kind === 'ready' && (
        <div className="rounded-md border border-border bg-card p-3.5 space-y-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="size-4 mt-0.5 shrink-0 text-emerald-500" />
            <div className="text-[13px]">
              v{status.update.version} の準備が整いました。再起動でアップデートが適用されます。
            </div>
          </div>
          <Button size="sm" onClick={() => { void relaunchNow(); }}>
            今すぐ再起動
          </Button>
        </div>
      )}

      {status.kind === 'error' && (
        <div className="flex items-start gap-2 text-[13px] text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <div>更新確認でエラーが発生しました。</div>
            <div className="text-[11px] text-muted-foreground break-all">{status.message}</div>
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        GitHub Releases から最新版を取得しています。アップデートは署名検証されます。
      </p>
    </div>
  );
}

function ProgressBar({ downloaded, total }: { readonly downloaded: number; readonly total: number | null }) {
  const pct = total != null && total > 0 ? Math.min(100, (downloaded / total) * 100) : null;
  return (
    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full bg-foreground transition-[width] duration-200 ease-out ${pct == null ? 'animate-pulse w-1/3' : ''}`}
        style={pct != null ? { width: `${pct}%` } : undefined}
      />
    </div>
  );
}
