import type { ReactNode } from 'react';

type SectionProps = { readonly title: string; readonly children: ReactNode };

function Section({ title, children }: SectionProps) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="text-[13px] text-foreground leading-relaxed space-y-1.5">
        {children}
      </div>
    </section>
  );
}

function Row({ label, body }: { label: ReactNode; body: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="shrink-0 text-foreground/85 font-medium min-w-[120px]">{label}</span>
      <span className="text-foreground/75">{body}</span>
    </div>
  );
}

export function HelpPanel({ onOpenShortcuts }: { onOpenShortcuts: () => void }) {
  return (
    <div className="space-y-5 text-sm">
      <Section title="基本操作">
        <Row label="タスクを作る" body="空き時間をドラッグするか、ダブルクリックで30分ブロック。サイドバーの案件をドラッグ＆ドロップしても作れます。" />
        <Row label="編集" body="ブロックを右クリックで編集ダイアログ。" />
        <Row label="移動 / 伸縮" body="ブロックをドラッグで移動。下端を掴んでドラッグでリサイズ。" />
        <Row label="重なり" body="同じ時間に複数ブロックを置けます。横に並んで表示されます。" />
        <Row label="やり直し" body={<>誤操作は <kbd className="px-1 rounded bg-muted text-xs">⌘Z</kbd> / <kbd className="px-1 rounded bg-muted text-xs">⌘⇧Z</kbd>。</>} />
      </Section>

      <Section title="案件と工数管理">
        <Row label="案件を登録" body="設定 → 案件設定 で追加。色、月予算 (人月)、負荷 (軽/中/重)、ピン留めを設定。" />
        <Row label="ピン留め" body="ピン留めした案件のみサイドバーに表示され、ドラッグ可能になります。" />
        <Row label="月次サマリー" body={<>ヘッダーのグラフアイコンか <kbd className="px-1 rounded bg-muted text-xs">S</kbd> キーで開きます。案件別の実績・予算消化・予測オーバー警告。</>} />
      </Section>

      <Section title="配分提案">
        <Row label="呼び出し" body={<>ヘッダーの ✨ アイコンか <kbd className="px-1 rounded bg-muted text-xs">G</kbd> キー。日ビューならその日、週ビューなら月-金の配分を提案。</>} />
        <Row label="ロジック" body="ピン留め案件の月予算 × 残営業日 × 案件の負荷 × 時間帯 (午前=高負荷向き、午後遅め=軽め) を見て、空きスロットに割り付けます。" />
        <Row label="採用" body="提案ダイアログで個別に取捨選択して「採用」。Undo で巻き戻し可能。" />
      </Section>

      <Section title="Google Calendar 連携">
        <Row label="接続" body="設定 → Google Calendar 連携 で接続。読み取り専用で、カレンダー予定を取り込みます。" />
        <Row label="案件割当" body="GCal の予定を右クリックして案件を割当。同じタイトルの予定をまとめて割り当てるオプションあり。" />
        <Row label="非表示" body="個別の予定を非表示にしたり、同名予定を全て非表示にできます。" />
      </Section>

      <Section title="ショートカット">
        <button
          type="button"
          onClick={onOpenShortcuts}
          className="text-primary hover:underline text-[13px]"
        >
          ショートカット一覧を開く
        </button>
      </Section>
    </div>
  );
}
