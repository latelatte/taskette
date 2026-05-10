type Release = {
  readonly version: string;
  readonly date: string;
  readonly highlights: readonly string[];
};

const RELEASES: readonly Release[] = [
  {
    version: '0.1.0',
    date: '2026-05-11',
    highlights: [
      '初版。日 / 週 / 月 / 年ビューでのタイムブロック管理',
      '案件単位の月予算 (人月) と消化率トラッキング、月次サマリー',
      'Google Calendar 連携 (読み取り専用、案件割当、自動同期)',
      'ピン留め案件と負荷を考慮した自動配分提案 (日 / 週単位)',
      'Undo / Redo、ブロック重なり許可 (横並び表示)',
      '通知 (開始 N 分前、カスタム音)',
      'Tauri デスクトップアプリ (SQLite + Keychain refresh token)',
    ],
  },
];

export function ReleaseNotesPanel() {
  return (
    <div className="space-y-6 text-sm">
      {RELEASES.map((r) => (
        <section key={r.version} className="space-y-2">
          <header className="flex items-baseline gap-3">
            <h3 className="text-base font-semibold text-foreground">v{r.version}</h3>
            <span className="text-[12px] text-muted-foreground">{r.date}</span>
          </header>
          <ul className="space-y-1 text-[13px] text-foreground/80 leading-relaxed">
            {r.highlights.map((h, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-muted-foreground/60 shrink-0">·</span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
