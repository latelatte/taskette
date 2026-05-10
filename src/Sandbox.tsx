import { useState } from 'react';
import { Settings2, Sparkles, Calendar as CalendarIcon } from 'lucide-react';
import { cn } from './lib/utils.js';
import { Button } from './components/ui/button.js';
import { Input } from './components/ui/input.js';
import { Label } from './components/ui/label.js';
import { Switch } from './components/ui/switch.js';
import { Separator } from './components/ui/separator.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './components/ui/dialog.js';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './components/ui/popover.js';

const roseShades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

const semanticPairs: Array<{ label: string; bg: string; fg: string }> = [
  { label: 'background / foreground', bg: 'bg-background', fg: 'text-foreground' },
  { label: 'card / card-foreground', bg: 'bg-card', fg: 'text-card-foreground' },
  { label: 'popover / popover-foreground', bg: 'bg-popover', fg: 'text-popover-foreground' },
  { label: 'primary / primary-foreground', bg: 'bg-primary', fg: 'text-primary-foreground' },
  { label: 'secondary / secondary-foreground', bg: 'bg-secondary', fg: 'text-secondary-foreground' },
  { label: 'muted / muted-foreground', bg: 'bg-muted', fg: 'text-muted-foreground' },
  { label: 'accent / accent-foreground', bg: 'bg-accent', fg: 'text-accent-foreground' },
  { label: 'destructive / destructive-foreground', bg: 'bg-destructive', fg: 'text-destructive-foreground' },
];

const radiusItems = [
  { label: 'sm', cls: 'rounded-sm' },
  { label: 'md', cls: 'rounded-md' },
  { label: 'lg', cls: 'rounded-lg' },
  { label: 'xl', cls: 'rounded-xl' },
  { label: 'full', cls: 'rounded-full' },
];

const shadowItems = [
  { label: 'soft', style: { boxShadow: 'var(--shadow-soft)' } },
  { label: 'floaty', style: { boxShadow: 'var(--shadow-floaty)' } },
  { label: 'popover', style: { boxShadow: 'var(--shadow-popover)' } },
];

const fontSizes = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase mb-4">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Sandbox() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);
  const [project, setProject] = useState<string>('proj-a');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-8 py-12">
        <header className="mb-12 pb-6 border-b">
          <h1 className="text-3xl font-semibold tracking-tight">taskette design tokens</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Slice 13-A/B — Tailwind v4 + shadcn/ui 足場確認用ページ。?sandbox=1 で表示。
          </p>
        </header>

        <Section title="Dusty rose palette (accent)">
          <div className="grid grid-cols-10 gap-2">
            {roseShades.map((shade) => (
              <div key={shade} className="flex flex-col items-center gap-2">
                <div
                  className={cn('w-full h-16 rounded-md border')}
                  style={{ backgroundColor: `var(--color-rose-${shade})` }}
                />
                <span className="text-xs text-muted-foreground">{shade}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Semantic colors">
          <div className="grid grid-cols-2 gap-4">
            {semanticPairs.map((pair) => (
              <div
                key={pair.label}
                className={cn(
                  'p-4 rounded-lg border flex items-center justify-between',
                  pair.bg,
                  pair.fg,
                )}
              >
                <span className="text-sm font-medium">{pair.label}</span>
                <span className="text-xs opacity-60">Aa</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Radius scale">
          <div className="flex gap-4 flex-wrap">
            {radiusItems.map((item) => (
              <div key={item.label} className="flex flex-col items-center gap-2">
                <div className={cn('w-20 h-20 bg-primary', item.cls)} />
                <span className="text-xs text-muted-foreground">{item.label}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Shadow scale">
          <div className="flex gap-6 flex-wrap p-6 bg-muted/30 rounded-xl">
            {shadowItems.map((item) => (
              <div key={item.label} className="flex flex-col items-center gap-2">
                <div
                  className="w-32 h-20 bg-card rounded-lg border"
                  style={item.style}
                />
                <span className="text-xs text-muted-foreground">{item.label}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Typography">
          <div className="space-y-2">
            {fontSizes.map((cls) => (
              <div key={cls} className={cn('flex items-baseline gap-4', cls)}>
                <span className="text-xs text-muted-foreground w-16 font-mono">{cls}</span>
                <span>The quick brown fox jumps — 案件別の月次工数を集計</span>
              </div>
            ))}
          </div>
        </Section>

        <Separator className="my-8" />
        <h2 className="text-xs font-semibold tracking-widest text-rose-700 uppercase mb-2">
          shadcn/ui live samples
        </h2>
        <p className="text-sm text-muted-foreground mb-8">
          以下は実際の shadcn コンポーネント。既存モーダル置き換え用の素材。
        </p>

        <Section title="Button variants">
          <div className="flex gap-3 flex-wrap items-center">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link</Button>
            <Button variant="destructive">Destructive</Button>
          </div>
          <div className="flex gap-3 flex-wrap items-center mt-4">
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="settings">
              <Settings2 />
            </Button>
            <Button>
              <Sparkles />
              With icon
            </Button>
          </div>
        </Section>

        <Section title="Form controls">
          <div className="grid grid-cols-2 gap-6 max-w-2xl">
            <div className="space-y-2">
              <Label htmlFor="block-label">ブロック名</Label>
              <Input id="block-label" placeholder="例: 議事録レビュー" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-select">案件</Label>
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger id="project-select" className="w-full">
                  <SelectValue placeholder="案件を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="proj-a">案件A — Web 改修</SelectItem>
                  <SelectItem value="proj-b">案件B — AI コンサル</SelectItem>
                  <SelectItem value="proj-c">案件C — 社内</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="silent-refresh"
                checked={switchOn}
                onCheckedChange={setSwitchOn}
              />
              <Label htmlFor="silent-refresh">GCal 自動再接続</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="dark-mode" disabled />
              <Label htmlFor="dark-mode" className="text-muted-foreground">
                ダークモード（後回し）
              </Label>
            </div>
          </div>
        </Section>

        <Section title="Dialog (Apple-ish translucency 検証用)">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <CalendarIcon />
                ブロックを編集
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>ブロックを編集</DialogTitle>
                <DialogDescription>
                  時刻・案件・ラベルを変更できます。会社ツール転記用にラベルは判別しやすい名前を推奨。
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="dlg-label">ラベル</Label>
                  <Input id="dlg-label" defaultValue="議事録レビュー" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="dlg-start">開始時刻</Label>
                    <Input id="dlg-start" type="time" defaultValue="14:30" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dlg-dur">時間 (分)</Label>
                    <Input id="dlg-dur" type="number" defaultValue={60} step={15} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dlg-proj">案件</Label>
                  <Select defaultValue="proj-a">
                    <SelectTrigger id="dlg-proj" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="proj-a">案件A</SelectItem>
                      <SelectItem value="proj-b">案件B</SelectItem>
                      <SelectItem value="proj-c">案件C</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                  キャンセル
                </Button>
                <Button variant="destructive">削除</Button>
                <Button onClick={() => setDialogOpen(false)}>保存</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Section>

        <Section title="Popover (block edit popup の素材)">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">日次サマリーを開く</Button>
            </PopoverTrigger>
            <PopoverContent className="w-72">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">2026-05-09 (Sat)</span>
                  <span className="text-xs text-muted-foreground">7.5h 計上</span>
                </div>
                <Separator />
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span>案件A</span>
                    <span className="text-muted-foreground">3.0h</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>案件B</span>
                    <span className="text-muted-foreground">2.5h</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>未割当</span>
                    <span className="text-muted-foreground">2.0h</span>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </Section>

        <Section title="Card mock (Linear-like)">
          <div
            className="bg-card border rounded-xl p-6 max-w-md"
            style={{ boxShadow: 'var(--shadow-floaty)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">案件A — 5月見込み</h3>
              <span className="text-xs text-muted-foreground">0.6 人月</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              実績 84h / 予算 96h ± 12h（許容 84h–108h）
            </p>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full"
                style={{ width: '88%' }}
              />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
