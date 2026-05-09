# Notification sounds

`.mp3` / `.wav` / `.m4a` ファイルをこのディレクトリに置くと、ブラウザの HTML5 Audio で再生されますの。

追加手順:

1. このディレクトリに音ファイルをコピー (例: `chime.mp3`)
2. `src/sounds.ts` に 1 行追加:
   ```ts
   { id: 'chime', kind: 'custom', label: 'Chime', url: '/sounds/chime.mp3' },
   ```
3. 設定 → 一般 → 通知音 で選べるようになる

短め (1〜3 秒) のものが通知音として馴染みますわ。
