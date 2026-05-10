import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
import { isMac } from '../lib/utils.js';

const cmdSym = isMac ? '⌘' : 'Ctrl';

type Group = {
  readonly category: string;
  readonly entries: readonly { readonly keys: readonly string[]; readonly description: string }[];
};

const SHORTCUTS: readonly Group[] = [
  {
    category: 'ビュー / 移動',
    entries: [
      { keys: ['1'], description: '日ビュー' },
      { keys: ['2'], description: '週ビュー' },
      { keys: ['3'], description: '月ビュー' },
      { keys: ['4'], description: '年ビュー' },
      { keys: ['←'], description: '前のページ' },
      { keys: ['→'], description: '次のページ' },
      { keys: ['T'], description: '今日へジャンプ' },
      { keys: ['['], description: 'サイドバーを切替' },
    ],
  },
  {
    category: 'ダイアログ',
    entries: [
      { keys: ['G'], description: '配分提案を開く (日 / 週ビューのみ)' },
      { keys: ['S'], description: 'サマリーを開く' },
      { keys: [cmdSym, ','], description: '設定を開く' },
      { keys: ['?'], description: 'このヘルプを開く' },
      { keys: ['Esc'], description: '開いているダイアログを閉じる' },
    ],
  },
  {
    category: '編集',
    entries: [
      { keys: [cmdSym, 'Z'], description: '元に戻す (Undo)' },
      { keys: [cmdSym, '⇧', 'Z'], description: 'やり直し (Redo)' },
    ],
  },
];

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-1.5 rounded-md border border-border bg-muted text-xs font-mono font-medium text-foreground"
      style={{ boxShadow: 'var(--shadow-soft)' }}
    >
      {children}
    </kbd>
  );
}

export function KeyboardHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>キーボードショートカット</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {SHORTCUTS.map((group) => (
            <div key={group.category}>
              <h3 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase mb-2">
                {group.category}
              </h3>
              <div className="space-y-1.5">
                {group.entries.map((entry) => (
                  <div
                    key={entry.description}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-foreground">{entry.description}</span>
                    <div className="flex gap-1 shrink-0">
                      {entry.keys.map((k, i) => (
                        <Kbd key={i}>{k}</Kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
