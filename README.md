# taskette

時間ブロッキング × 月次工数管理。一日のタイムラインを案件単位で塗っていくと、月末に「どの案件に何時間使ったか」「予算をオーバーしそうか」が自動で集計される。

> **Status: pre-1.0 / personal use.** 一人で使う前提で作っています。複数デバイス同期や認証はまだ。

---

## 何が違うか

世の中のタイムブロッカーは綺麗にスケジュールを引くところまでで、**月単位の工数集計**まで面倒を見てくれない。taskette は逆で、

- 案件 (= プロジェクト) を最初に登録 → 月予算を**人月単位**で設定
- 日々のタスクは案件にひも付けて積む
- 月末に「人月予算 vs 実績」「予測オーバー警告」を自動で出す
- 会社の工数管理ツールへの転記用に**日次サマリー**も用意

時間管理の見た目は Google Calendar 風だが、**目的は工数管理**。

## 主な機能

| カテゴリ | 内容 |
|---|---|
| ビュー | 日 / 週 / 月 / 年 (キーで `1`-`4` 切替) |
| 入力 | 空き時間ドラッグ / ダブルクリック / サイドバーから案件を D&D |
| 編集 | ブロックを右クリックで編集ダイアログ。下端ドラッグでリサイズ |
| 重なり | 許可。打ち合わせ中の内職など並列コミットメントを記録できる (横並び表示) |
| 案件管理 | 色 / 月予算 (人月) / 負荷 (軽中重) / ピン留め |
| 月次サマリー | 案件別実績 + 予算消化率 + 予測オーバー警告 |
| 配分提案 | ピン留め案件の残予算と負荷を踏まえた自動配置 (日 / 週単位) |
| Google Calendar | 読み取り専用同期。予定に案件を割り当てて工数集計に含める |
| Undo / Redo | `⌘Z` / `⌘⇧Z` |
| 通知 | ブロック開始 N 分前にデスクトップ通知 (カスタム音対応) |
| 永続化 | Tauri は SQLite + macOS Keychain。Browser は localStorage (移行用) |

詳しい使い方は、起動後に **設定 → 使い方** で確認できる。

## セットアップ

### Browser (開発・お試し)

```bash
npm install
npm run dev
# http://localhost:5173
```

GCal 連携を使うなら `.env.local` を作る:

```env
VITE_GOOGLE_CLIENT_ID=<your_web_client_id>.apps.googleusercontent.com
```

Web 版は OAuth Implicit Flow (popup, 1 時間で再認証) のみ。永続的な refresh は Tauri 版で。

### Tauri (実用)

前提: Rust toolchain (rustup) 済み。

```bash
npm install
npm run tauri:dev   # 開発モード
npm run tauri:build # .app/.dmg を生成
```

GCal 連携には Web client に加えて **Desktop client** が要る:

```env
VITE_GOOGLE_DESKTOP_CLIENT_ID=<your_desktop_client_id>.apps.googleusercontent.com
VITE_GOOGLE_DESKTOP_CLIENT_SECRET=<your_desktop_client_secret>
```

Desktop client + PKCE でも Google の token endpoint は client_secret を要求するので必須。Authorization Code Flow + loopback 127.0.0.1 random port で popup なし、refresh token は macOS Keychain に保存される。

### Browser → Tauri データ移行

Browser 版で localStorage に貯めたデータを Tauri 版に持ち込む手順:

1. Browser 版を開いて DevTools コンソールで `copy(localStorage.getItem('taskette/v1'))`
2. Tauri 版を起動して **設定 → データ移行** にペーストして取り込む

## 開発

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest
npm run build       # 本番バンドル生成
```

主要ディレクトリ:

```
src/
  domain/      # 純粋ロジック (Day, budget, allocate, ...)
  views/       # 日/週/月/年ビュー
  components/  # ダイアログ・パネル類
  gcal/        # Google Calendar 連携
  storage.ts   # localStorage / SQLite backend
src-tauri/     # Tauri 側 Rust コード
tests/         # vitest
```

## 技術選択

- React 19 + Vite + TypeScript
- Tailwind v4 + shadcn/ui (new-york)
- Tauri 2.x + tauri-plugin-sql (SQLite) + macOS Keychain
- Google Identity Services (browser) / Authorization Code Flow + PKCE (Tauri)
- vitest

## 設計上のメモ

- **重なり許可は意図的**: 打ち合わせ出席+内職など並列実働を反映するため。集計は per-project 合算なので、A 案件と B 案件が同時に 1h 積まれていれば「A に 1h、B に 1h」が正しい意味論。
- **GCal は read-only**: GCal → taskette の取り込みのみ。書き込みは未実装 (検討中)。
- **Browser localStorage は移行用**: 実用は Tauri + SQLite を前提。Browser 版はデザイン QA とデータ移行元のための preview。
- **テンプレート機構は UI 凍結**: DB schema と既存ブロックの色解決のために残しているが、新規追加 UI は外している。

## License

MIT (`LICENSE` 参照)。
