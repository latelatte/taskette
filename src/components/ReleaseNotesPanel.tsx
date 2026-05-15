type Release = {
  readonly version: string;
  readonly date: string;
  readonly highlights: readonly string[];
};

const RELEASES: readonly Release[] = [
  {
    version: '0.5.1',
    date: '2026-05-16',
    highlights: [
      '新しいバージョンが配信されると、起動時に自動でアップデート案内ダイアログが表示されるようになりました',
      'Drive 同期の完了メッセージを「アップロードしました」に変更し、内部的な世代番号の表示をやめました',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-05-15',
    highlights: [
      '複数デバイス間のデータ同期に対応。設定 > Google 連携 で「Drive 同期」を有効化すると、ブロック・案件・テンプレートが他の端末と自動で揃います',
      '別の端末と同じ行を同時に編集した場合は、最後に編集した内容が優先されます',
      'Google Calendar 連携と Drive 同期を「Google 連携」ページにまとめて整理しました',
    ],
  },
  {
    version: '0.4.1',
    date: '2026-05-12',
    highlights: [
      'macOS と Windows のビルドで SQL マイグレーションのチェックサムが食い違い、起動時に「migration N was previously applied but has been modified」警告が出ていた問題を修正',
      'クロスプラットフォーム開発の標準に倣い、リポジトリ全体の改行コードを LF に統一 (`.gitattributes`)',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-05-12',
    highlights: [
      'Windows 版を初リリース。CI で macOS + Windows 両方を自動ビルド (NSIS / MSI インストーラー)',
      'プラットフォームに応じてキーボードショートカット表記を Cmd / Ctrl で自動切替',
      'Windows ではキーチェーンの代わりに Windows Credential Manager に refresh token を保存',
      'CI ビルドの配布物に Google OAuth Client ID が含まれていなかった不具合を修正',
    ],
  },
  {
    version: '0.3.1',
    date: '2026-05-12',
    highlights: [
      '案件に開始日・終了日の期間入力を追加。設定パネルから直接編集 / クリア可能',
      '終了済の案件が当月のサマリーで誤警告される不具合を修正',
      '案件のライフサイクル判定を期間ベース (開始日〜終了日) に統一',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-05-11',
    highlights: [
      'アプリ内アップデート機能を追加。GitHub Releases から自動で最新版を取得',
      '起動時に裏で更新確認、設定 > アップデートから手動チェックも可能',
      'ダウンロード進捗バーと「再起動で適用」フロー、署名検証付き',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-05-11',
    highlights: [
      '案件にライフサイクル概念を追加。「進行中」「終了済」セクションで管理',
      '案件設定でドラッグ&ドロップによる並び替え。セクション間移動で開始/終了も切替可',
      '各案件に明示的な「終了」「再開」ボタン (任意で終了月も指定可能)',
      '終了済案件はサマリー / サイドバー / 配分提案から自動除外。過去の月を見れば履歴は引き続き表示',
      '週ビューに各日の実績ストリップ (合計時間 + 案件色バー) を追加',
      '月ビューに月次実績ストリップを追加。各日セルにマウスホバーで案件別内訳ツールチップ',
      'Google Calendar 設定ページを整理。非表示中イベント / 同名予定ルールを検索付きサブページに分離',
      'カスタムアプリアイコン',
    ],
  },
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
