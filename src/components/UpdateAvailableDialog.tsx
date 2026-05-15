/**
 * Auto-popup informing the user that a new version is available. Opens
 * automatically once per detected version; can be re-opened from Settings
 * if dismissed. Adapts its body to the current updater status so the
 * download / restart steps reuse the same dialog frame.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from './ui/dialog.js';
import { Button } from './ui/button.js';
import { Download, CheckCircle2, AlertCircle } from 'lucide-react';
import { formatProgress, type UseUpdater } from '../updater.js';

type Props = {
  readonly updater: UseUpdater;
};

export function UpdateAvailableDialog({ updater }: Props): JSX.Element | null {
  const [open, setOpen] = useState(false);
  // Tracks the version we've already auto-opened for; prevents the dialog
  // from reappearing if the user dismissed it for that same version.
  const seenVersionRef = useRef<string | null>(null);

  useEffect(() => {
    if (updater.status.kind === 'available') {
      const v = updater.status.update.version;
      if (seenVersionRef.current !== v) {
        seenVersionRef.current = v;
        setOpen(true);
      }
    } else if (updater.status.kind === 'ready') {
      // Always surface the "restart now" prompt; it's an actionable step
      // the user can dismiss but shouldn't miss.
      setOpen(true);
    }
  }, [updater.status]);

  // Only render once the updater has something to show.
  if (
    updater.status.kind !== 'available' &&
    updater.status.kind !== 'downloading' &&
    updater.status.kind !== 'ready' &&
    updater.status.kind !== 'error'
  ) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        {updater.status.kind === 'available' && (
          <>
            <DialogTitle>新しいバージョンが利用可能です</DialogTitle>
            <DialogDescription>
              v{updater.status.update.version} に更新できます。
              {updater.status.update.date && ` (${updater.status.update.date})`}
            </DialogDescription>
            {updater.status.update.notes !== null && updater.status.update.notes.length > 0 && (
              <div className="text-[12px] text-foreground/85 leading-relaxed whitespace-pre-wrap border-l-2 border-border pl-3 max-h-48 overflow-auto">
                {updater.status.update.notes}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                後で
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  void updater.downloadAndInstall();
                }}
              >
                <Download className="size-3.5" />
                今すぐ更新
              </Button>
            </DialogFooter>
          </>
        )}

        {updater.status.kind === 'downloading' && (
          <>
            <DialogTitle>v{updater.status.update.version} をダウンロード中…</DialogTitle>
            <ProgressBar
              downloaded={updater.status.downloaded}
              total={updater.status.total}
            />
            <div className="text-[11px] text-muted-foreground tabular-nums">
              {formatProgress(updater.status.downloaded, updater.status.total)}
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                背景で続行
              </Button>
            </DialogFooter>
          </>
        )}

        {updater.status.kind === 'ready' && (
          <>
            <DialogTitle>再起動の準備が整いました</DialogTitle>
            <DialogDescription>
              v{updater.status.update.version} は再起動で適用されます。
            </DialogDescription>
            <div className="flex items-start gap-2 text-[13px] text-muted-foreground">
              <CheckCircle2 className="size-4 mt-0.5 shrink-0 text-emerald-500" />
              <span>ダウンロードと検証が完了しました。</span>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                後で
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  void updater.relaunchNow();
                }}
              >
                今すぐ再起動
              </Button>
            </DialogFooter>
          </>
        )}

        {updater.status.kind === 'error' && (
          <>
            <DialogTitle>更新中にエラーが発生しました</DialogTitle>
            <div className="flex items-start gap-2 text-[13px] text-destructive">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <div>更新を完了できませんでした。</div>
                <div className="text-[11px] text-muted-foreground break-all">
                  {updater.status.message}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                閉じる
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProgressBar({
  downloaded,
  total,
}: {
  readonly downloaded: number;
  readonly total: number | null;
}): JSX.Element {
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
