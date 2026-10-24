# taskette

時間ブロッキング × 月次工数管理。一日のタイムラインを案件単位で塗っていくと、月末に「どの案件に何時間使ったか」「予算をオーバーしそうか」が自動で集計される。

> **Status: pre-1.0 / personal use.** 一人で使う前提で作っているが、複数デバイス間の Google Drive 同期、macOS / Windows の公式ビルド配布、アプリ内自動アップデートには対応済み。

---

## 何が違うか

世の中のタイムブロッカーは綺麗にスケジュールを引くところまでで、**月単位の工数集計**まで面倒を見てくれない。taskette は逆で、

- 案件 (= プロジェクト) を最初に登録 → 月予算を**人月単位**で設定
- 日々のタスクは案件にひも付けて積む
- 月末に「人月予算 vs 実績」「予測オーバー警告」を自動で出す
- 会社の工数管理ツールへの転記用に**月次サマリー**も用意

時間管理の見た目は Google Calendar 風だが、**目的は工数管理**。

## 主な機能

| カテゴリ | 内容 |
|---|---|
| ビュー | 日 / 週 / 月 / 年 (キーで `1`-`4` 切替) |
| 入力 | 空き時間ドラッグ / ダブルクリック / サイドバーから案件を D&D |
| 編集 | ブロックを右クリックで編集ダイアログ。下端ドラッグでリサイズ。作業時間はスライダー / マウスホイールでも調整可 |
| 重なり | 許可。打ち合わせ中の内職など並列コミットメントを記録できる (横並び表示) |
| 案件管理 | 色 / 月予算 (人月) / 負荷 (軽中重) / ピン留め / 稼働期間 (開始日・終了日) |
| 月次サマリー | 案件別実績 + 予算消化率 + 予測オーバー警告。工数を設定した有償案件を優先表示 |
| 配分提案 | ピン留め案件の残予算と負荷を踏まえた自動配置 (日 / 週単位) |
| Google Calendar | 読み取り専用 (pull-only)。予定に案件を割り当てて工数集計に含める |
| デバイス間同期 | Google Drive 経由でブロック・案件・テンプレートを複数端末に自動同期 (行レベル last-write-wins) |
| 通知 | ブロック開始 N 分前にデスクトップ通知。複数タイミングの同時指定、カスタム音、デフォルト通知設定に対応 |
| 自動アップデート | GitHub Releases から最新版を取得。起動時に案内ダイアログ、設定から手動チェックも可 |
| Undo / Redo | `⌘Z` / `⌘⇧Z` |
| 永続化 | Tauri は SQLite + OS 資格情報ストア (macOS Keychain / Windows Credential Manager)。Browser は localStorage (移行用) |

詳しい使い方は、起動後に **設定 → 使い方** で確認できる。

## インストール (公式ビルド)

[GitHub Releases](https://github.com/latelatte/taskette/releases/latest) から最新版をダウンロードできる。

- **macOS**: `.dmg` を開いて `Taskette.app` を Applications にドラッグ (Apple Silicon / Intel 両対応の universal binary)
- **Windows**: `.exe` (NSIS, 推奨) または `.msi` を実行

初回起動時は未署名のため警告が出る (macOS は Gatekeeper、Windows は SmartScreen)。手動で実行を許可すれば以降は素通り (詳細は下記)。インストール後は新バージョン公開時にアプリ内で自動更新できる。

## セットアップ (開発)

### Browser (お試し・デザイン QA)

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
npm run tauri:dev   # 開発モード (HMR、デバッグ用)
npm run tauri:build # 本番ビルド (実行中の OS 向けにバンドル生成)
```

ローカルビルドの成果物:

```
src-tauri/target/release/bundle/
├── macos/Taskette.app                       # アプリ本体 (macOS)
├── dmg/Taskette_<version>_<arch>.dmg         # インストーラ (macOS)
├── nsis/Taskette_<version>_x64-setup.exe     # インストーラ (Windows / NSIS)
└── msi/Taskette_<version>_x64_en-US.msi      # インストーラ (Windows / MSI)
```

> 公式リリースはタグ push をトリガに GitHub Actions が macOS (universal) と Windows を自動ビルドし、署名付き updater アーティファクトと共に Draft Release を作る。リリース手順は `scripts/release.sh` を参照。

GCal 連携には Web client に加えて **Desktop client** が要る:

```env
VITE_GOOGLE_DESKTOP_CLIENT_ID=<your_desktop_client_id>.apps.googleusercontent.com
VITE_GOOGLE_DESKTOP_CLIENT_SECRET=<your_desktop_client_secret>
```

Desktop client + PKCE でも Google の token endpoint は client_secret を要求するので必須。Authorization Code Flow + loopback 127.0.0.1 random port で popup なし、refresh token は OS の資格情報ストア (macOS Keychain / Windows Credential Manager) に保存される。

> 配布バイナリでこれらを有効にするには、CI に同名のシークレットを注入する必要がある (`.env.local` は gitignore のためビルドに焼かれない)。

### 初回起動時の挙動 (macOS)

1. **「開発元未確認」警告** — ad-hoc 署名 (`signingIdentity: "-"`) のため Apple Notarization なし。Finder で `Taskette.app` を **右クリック → 開く → 「開く」** で 1 回だけ承認すれば以降は素通り。
2. **通知の許可ダイアログ** — `tauri-plugin-notification` 経由で macOS に通知許可を要求。「許可」を選べばタスク開始 N 分前の通知が動く。
3. **Keychain アクセス許可** (GCal 接続時) — refresh token を `ai.latelatte.taskette.google` という Service 名で Keychain に保存。「常に許可」で permanent、「許可」だと毎回確認。

Windows は初回に SmartScreen の警告が出る。「詳細情報 → 実行」で許可する。refresh token は Windows Credential Manager に保存される。

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
  sync/        # Google Drive 同期 (envelope / merge / orchestrator)
  storage.ts   # localStorage / SQLite backend
src-tauri/     # Tauri 側 Rust コード + SQL マイグレーション
tests/         # vitest
```

## 技術選択

- React 19 + Vite + TypeScript
- Tailwind v4 + shadcn/ui (new-york)
- Tauri 2.x + tauri-plugin-sql (SQLite) + OS 資格情報ストア (keyring)
- Google Identity Services (browser) / Authorization Code Flow + PKCE (Tauri)
- Google Drive (appDataFolder) によるデバイス間同期
- tauri-plugin-updater + GitHub Releases によるアプリ内自動アップデート
- vitest

## 設計上のメモ

- **重なり許可は意図的**: 打ち合わせ出席+内職など並列実働を反映するため。集計は per-project 合算なので、A 案件と B 案件が同時に 1h 積まれていれば「A に 1h、B に 1h」が正しい意味論。
- **GCal は pull-only**: GCal → taskette の取り込みのみ。taskette → GCal の書き込みは設計上やらない (タスクとスケジュールを混ぜない方針)。
- **Drive 同期は行レベル last-write-wins**: 同じ行を別端末で同時編集したら、最後の編集が勝つ。コンフリクトは監査用に記録する。Drive v3 は HTTP-level の CAS が使えないため、`appProperties` ベースの soft CAS で best-effort に世代衝突を抑える。
- **Browser localStorage は移行用**: 実用は Tauri + SQLite を前提。Browser 版はデザイン QA とデータ移行元のための preview。
- **テンプレート機構は UI 凍結**: DB schema と既存ブロックの色解決のために残しているが、新規追加 UI は外している。

## ステータス

- 動作確認済プラットフォーム: **macOS (Apple Silicon / Intel universal)** および **Windows**
- 公式配布: GitHub Releases で macOS (`.dmg`) / Windows (`.exe` / `.msi`) を配布。アプリ内自動アップデート対応
- 署名: macOS は ad-hoc 署名のみで Notarization なし、Windows は未署名。初回起動の Gatekeeper / SmartScreen 警告は手動承認が要る
- Linux / Intel Mac 単体ビルドは未検証 (universal binary には Intel スライスを含む)

## License

MIT (`LICENSE` 参照)。
