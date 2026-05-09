import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { DateString, GcalAssignment, Project, TaskTemplate, TimeBlock } from './domain/types.js';
import { Day } from './domain/day.js';
import { PROJECT_COLOR_PALETTE } from './projects.js';
import { addDays, addMonths, daysOfWeek, elapsedRatio, formatJaDate, formatJaYearMonth, today, yearMonthOf, yearOf } from './dates.js';
import type { ViewMode } from './views/types.js';
import { DayView } from './views/DayView.js';
import { WeekView } from './views/WeekView.js';
import { MonthView } from './views/MonthView.js';
import { YearView } from './views/YearView.js';
import { loadStore, saveStore, importStoreFromJson, isUsingTauriBackend } from './storage.js';
import { aggregateMonthly } from './domain/aggregate.js';
import { effectiveBudgetPM, projectBudgetUsage } from './domain/budget.js';
import { useGcalAuth } from './gcal/useGcalAuth.js';
import { useGcalSync } from './gcal/useGcalSync.js';
import { useGcalCalendarList } from './gcal/useGcalCalendarList.js';
import { mergeDayBlocks } from './gcal/merge.js';
import {
  BarChart3,
  Bell,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Settings2,
} from 'lucide-react';
import { cn } from './lib/utils.js';
import { Button } from './components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog.js';
import { Input } from './components/ui/input.js';
import { Label } from './components/ui/label.js';
import { Checkbox } from './components/ui/checkbox.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select.js';
import { KeyboardHelpDialog } from './components/KeyboardHelpDialog.js';
import {
  getNotificationPermission,
  previewSound,
  requestNotificationPermission,
  useNotificationScheduler,
  type NotifyPermission,
} from './notifications.js';
import { SOUNDS, loadSelectedSoundId, saveSelectedSoundId } from './sounds.js';

const SELECTED_CALENDAR_KEY = 'taskette/gcal-calendar-id';

const fmtH = (h: number): string => {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? r.toString() : r.toFixed(1);
};

const pad2 = (n: number): string => n.toString().padStart(2, '0');

const formatHHMM = (m: number): string => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

const parseHHMM = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (m === null) return null;
  const h = parseInt(m[1] ?? '0', 10);
  const mm = parseInt(m[2] ?? '0', 10);
  if (h < 0 || h > 24 || mm < 0 || mm >= 60) return null;
  return h * 60 + mm;
};

type BlockEditState = {
  readonly blockId: string;
  readonly label: string;
  readonly startHHMM: string;
  readonly durationMin: string;
  readonly projectId: string;
  readonly source: 'native' | 'gcal';
  readonly gcalKey?: string;
  readonly gcalRecurring?: true;
  /** Select 用文字列。'' = 通知なし、それ以外は分数の文字列 ('0', '5', '10' ...) */
  readonly notifyOffset: string;
};

const NOTIFY_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: '0', label: '開始時' },
  { value: '5', label: '5分前' },
  { value: '10', label: '10分前' },
  { value: '15', label: '15分前' },
  { value: '30', label: '30分前' },
  { value: '60', label: '1時間前' },
];

type SettingsView = 'menu' | 'general' | 'projects' | 'templates' | 'gcal' | 'data';

const SETTINGS_TITLES: Record<SettingsView, string> = {
  menu: '設定',
  general: '一般',
  projects: '案件設定',
  templates: 'テンプレート設定',
  gcal: 'Google Calendar 連携',
  data: 'データ移行',
};

const blockWithoutProject = (b: TimeBlock): TimeBlock => ({
  id: b.id,
  label: b.label,
  start: b.start,
  durationMin: b.durationMin,
  ...(b.templateId !== undefined ? { templateId: b.templateId } : {}),
});

const blockWithoutTemplate = (b: TimeBlock): TimeBlock => ({
  id: b.id,
  label: b.label,
  start: b.start,
  durationMin: b.durationMin,
  ...(b.projectId !== undefined ? { projectId: b.projectId } : {}),
});

const templateWithoutProject = (t: TaskTemplate): TaskTemplate => ({
  id: t.id,
  label: t.label,
  defaultDurationMin: t.defaultDurationMin,
  ...(t.color !== undefined ? { color: t.color } : {}),
});

const shiftViewDate = (s: DateString, mode: ViewMode, delta: number): DateString => {
  if (mode === 'day') return addDays(s, delta);
  if (mode === 'week') return addDays(s, delta * 7);
  if (mode === 'month') return `${addMonths(s, delta).slice(0, 7)}-01`;
  return `${addMonths(s, delta * 12).slice(0, 7)}-01`;
};

export function App() {
  const [currentDate, setCurrentDate] = useState<DateString>(today);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [blocksByDate, setBlocksByDate] = useState<Record<DateString, readonly TimeBlock[]>>({});
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [templates, setTemplates] = useState<readonly TaskTemplate[]>([]);
  const [gcalAssignments, setGcalAssignments] = useState<Record<string, GcalAssignment>>({});
  const [gcalSummaryRules, setGcalSummaryRules] = useState<Record<string, { projectId?: string; hidden?: true }>>({});
  const [editApplyToAllSameSummary, setEditApplyToAllSameSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockEdit, setBlockEdit] = useState<BlockEditState | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>('menu');
  const [showSummary, setShowSummary] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [notifyPermission, setNotifyPermission] = useState<NotifyPermission>('default');
  const [selectedSoundId, setSelectedSoundIdState] = useState<string>(() => loadSelectedSoundId());
  const setSelectedSoundId = (id: string): void => {
    setSelectedSoundIdState(id);
    saveSelectedSoundId(id);
  };
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectBudget, setNewProjectBudget] = useState('');
  const [newProjectColor, setNewProjectColor] = useState<string>(
    PROJECT_COLOR_PALETTE[0] ?? '#64748b',
  );
  const [colorPickerProjectId, setColorPickerProjectId] = useState<string | null>(null);
  const [newTemplateLabel, setNewTemplateLabel] = useState('');
  const [newTemplateDuration, setNewTemplateDuration] = useState('30');
  const [newTemplateProjectId, setNewTemplateProjectId] = useState<string>('');
  const [newTemplateColor, setNewTemplateColor] = useState<string>(
    PROJECT_COLOR_PALETTE[0] ?? '#64748b',
  );
  const [colorPickerTemplateId, setColorPickerTemplateId] = useState<string | null>(null);
  const [editingMonthBudgetProjectId, setEditingMonthBudgetProjectId] = useState<string | null>(null);
  const [editingMonthBudgetValue, setEditingMonthBudgetValue] = useState('');
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<'idle' | 'importing' | 'success' | 'error'>('idle');
  const [importError, setImportError] = useState<string | null>(null);

  const gcalAuth = useGcalAuth();
  const gcalCalendars = useGcalCalendarList(gcalAuth.accessToken);
  const [selectedCalendarId, setSelectedCalendarIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_CALENDAR_KEY);
    } catch {
      return null;
    }
  });
  const setSelectedCalendarId = (id: string | null): void => {
    setSelectedCalendarIdState(id);
    try {
      if (id === null || id.length === 0) localStorage.removeItem(SELECTED_CALENDAR_KEY);
      else localStorage.setItem(SELECTED_CALENDAR_KEY, id);
    } catch {
      // ignore
    }
  };
  const gcalSync = useGcalSync(gcalAuth.accessToken, currentDate, selectedCalendarId, gcalAssignments, gcalSummaryRules, gcalAuth.requestSilentRefresh);

  const mergedBlocksByDate = useMemo<Record<DateString, readonly TimeBlock[]>>(() => {
    const gcalBlocksByDate = gcalSync.blocksByDate;
    if (Object.keys(gcalBlocksByDate).length === 0) return blocksByDate;
    const out: Record<DateString, readonly TimeBlock[]> = { ...blocksByDate };
    for (const [date, gBlocks] of Object.entries(gcalBlocksByDate)) {
      const native = blocksByDate[date] ?? [];
      out[date] = mergeDayBlocks(native, gBlocks);
    }
    return out;
  }, [blocksByDate, gcalSync.blocksByDate]);

  useEffect(() => {
    let cancelled = false;
    loadStore()
      .then((state) => {
        if (cancelled) return;
        setBlocksByDate(state.blocksByDate);
        setProjects(state.projects);
        setTemplates(state.templates);
        setGcalAssignments(state.gcalAssignments);
        setGcalSummaryRules(state.gcalSummaryRules);
        setLoadStatus('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setLoadStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loadStatus !== 'ready') return;
    void saveStore({ blocksByDate, projects, templates, gcalAssignments, gcalSummaryRules });
  }, [loadStatus, blocksByDate, projects, templates, gcalAssignments, gcalSummaryRules]);

  useNotificationScheduler(blocksByDate);

  useEffect(() => {
    void getNotificationPermission().then(setNotifyPermission);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // 入力欄フォーカス中はショートカット無効
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target !== null && target.isContentEditable)
      ) return;

      // Dialog 開いている時はキーを Dialog に委ねる (Esc は Radix が処理)
      const hasOpenDialog =
        document.querySelector('[data-slot="dialog-content"][data-state="open"]') !== null;
      if (hasOpenDialog) return;

      const cmdOrCtrl = e.metaKey || e.ctrlKey;

      // 修飾キー付きショートカット
      if (cmdOrCtrl && e.key === ',') {
        e.preventDefault();
        setSettingsView('menu');
        setShowSettings(true);
        return;
      }

      // 以下、修飾キーなしのショートカットのみ
      if (cmdOrCtrl || e.altKey) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          setCurrentDate((d) => shiftViewDate(d, viewMode, -1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setCurrentDate((d) => shiftViewDate(d, viewMode, 1));
          break;
        case 't':
        case 'T':
          setCurrentDate(today());
          break;
        case '1':
          setViewMode('day');
          break;
        case '2':
          setViewMode('week');
          break;
        case '3':
          setViewMode('month');
          break;
        case '4':
          setViewMode('year');
          break;
        case '[':
          setSidebarCollapsed((c) => !c);
          break;
        case 's':
        case 'S':
          setShowSummary(true);
          break;
        case '?':
          setShowKeyboardHelp(true);
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [viewMode]);

  const blocks: readonly TimeBlock[] = mergedBlocksByDate[currentDate] ?? [];

  const setBlocks = (
    action: readonly TimeBlock[] | ((prev: readonly TimeBlock[]) => readonly TimeBlock[]),
  ): void => {
    setBlocksByDate((prev) => {
      const cur = prev[currentDate] ?? [];
      const updated = typeof action === 'function' ? action(cur) : action;
      const native = updated.filter((b) => b.source !== 'gcal');
      return { ...prev, [currentDate]: native };
    });
  };

  const templateById = useMemo(() => {
    const m = new Map<string, TaskTemplate>();
    for (const t of templates) m.set(t.id, t);
    return m;
  }, [templates]);

  const projectById = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of projects) m.set(p.id, p);
    return m;
  }, [projects]);

  const handleTemplateDragStart = (e: DragEvent<HTMLDivElement>, templateId: string): void => {
    e.dataTransfer.setData('kind', 'template');
    e.dataTransfer.setData('templateId', templateId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const openBlockEdit = (block: TimeBlock): void => {
    const isGcal = block.source === 'gcal';
    // GCal block を開いた時、個別 assignment が既にある場合のみ OFF (個別設定を維持)、それ以外はデフォルト ON
    const hasIndividualAssignment = isGcal && block.gcalKey !== undefined && gcalAssignments[block.gcalKey] !== undefined;
    setEditApplyToAllSameSummary(isGcal && !hasIndividualAssignment);
    setBlockEdit({
      blockId: block.id,
      label: block.label,
      startHHMM: formatHHMM(block.start),
      durationMin: String(block.durationMin),
      projectId: block.projectId ?? '',
      source: isGcal ? 'gcal' : 'native',
      notifyOffset: block.notifyOffsetMin !== undefined ? String(block.notifyOffsetMin) : '',
      ...(block.gcalKey !== undefined ? { gcalKey: block.gcalKey } : {}),
      ...(block.gcalRecurring === true ? { gcalRecurring: true as const } : {}),
    });
  };

  const closeBlockEdit = (): void => {
    setBlockEdit(null);
    setError(null);
  };

  const saveBlockEdit = (): void => {
    if (blockEdit === null) return;
    // GCal 由来は projectId のみ更新 (時間/ラベル変更不可)
    if (blockEdit.source === 'gcal' && blockEdit.gcalKey !== undefined) {
      const key = blockEdit.gcalKey;
      const summary = blockEdit.label;
      const projectId = blockEdit.projectId;

      if (editApplyToAllSameSummary) {
        // 「同名すべて」モード: summary rule を更新、個別 assignment は重複防止のため削除
        setGcalSummaryRules((prev) => {
          if (projectId === '') {
            // projectId 未割当なら summary rule を解除
            const { [summary]: _, ...rest } = prev;
            return rest;
          }
          return { ...prev, [summary]: { projectId } };
        });
        setGcalAssignments((prev) => {
          if (prev[key] === undefined) return prev;
          const cur = prev[key]!;
          // hidden だけ保持、projectId/summary は summary rule に委譲
          if (cur.hidden === true) {
            return { ...prev, [key]: { hidden: true as const, summary } };
          }
          const { [key]: _, ...rest } = prev;
          return rest;
        });
      } else {
        // 「この予定のみ」モード: 個別 assignment を更新
        setGcalAssignments((prev) => {
          const cur = prev[key] ?? {};
          const next: GcalAssignment = {
            ...(projectId !== '' ? { projectId } : {}),
            ...(cur.hidden === true ? { hidden: true as const } : {}),
            ...(summary !== '' ? { summary } : {}),
          };
          if (next.projectId === undefined && next.hidden !== true && next.summary === undefined) {
            const { [key]: _, ...rest } = prev;
            return rest;
          }
          return { ...prev, [key]: next };
        });
      }

      setError(null);
      setBlockEdit(null);
      return;
    }

    const trimmedLabel = blockEdit.label.trim();
    if (trimmedLabel.length === 0) {
      setError('ラベルを入力してくださいまし');
      return;
    }
    const start = parseHHMM(blockEdit.startHHMM);
    if (start === null) {
      setError('開始時刻の形式が不正ですわ (HH:MM)');
      return;
    }
    const dur = parseInt(blockEdit.durationMin, 10);
    if (!Number.isFinite(dur) || dur <= 0) {
      setError('時間 (分) を正の整数で入力してくださいまし');
      return;
    }
    if (start + dur > 1440) {
      setError('一日の範囲を超えていますわ');
      return;
    }

    const dayBlocks = blocksByDate[currentDate] ?? [];
    const original = dayBlocks.find((b) => b.id === blockEdit.blockId);
    if (original === undefined) {
      closeBlockEdit();
      return;
    }
    const notifyOffsetMin =
      blockEdit.notifyOffset === '' ? undefined : parseInt(blockEdit.notifyOffset, 10);
    const newBlock: TimeBlock = {
      id: original.id,
      label: trimmedLabel,
      start,
      durationMin: dur,
      ...(original.templateId !== undefined ? { templateId: original.templateId } : {}),
      ...(blockEdit.projectId !== '' ? { projectId: blockEdit.projectId } : {}),
      ...(notifyOffsetMin !== undefined && Number.isFinite(notifyOffsetMin)
        ? { notifyOffsetMin }
        : {}),
    };

    const others = dayBlocks.filter((b) => b.id !== blockEdit.blockId);
    const day = new Day(currentDate, others);
    const result = day.place(newBlock);
    if (!result.ok) {
      if (result.reason === 'overlap') {
        setError('重なっていますわ — 他のブロックと衝突しています');
      } else {
        setError(result.message);
      }
      return;
    }

    setBlocks(day.blocks);
    setError(null);
    setBlockEdit(null);
  };

  const deleteBlockFromEdit = (): void => {
    if (blockEdit === null) return;
    setBlocks((prev) => prev.filter((b) => b.id !== blockEdit.blockId));
    setError(null);
    setBlockEdit(null);
  };

  // 非表示は常に「この予定のみ」(誤爆防止)。シリーズ全体非表示は別ハンドラ。
  const hideGcalFromEdit = (): void => {
    if (blockEdit === null || blockEdit.source !== 'gcal' || blockEdit.gcalKey === undefined) return;
    const key = blockEdit.gcalKey;
    const summary = blockEdit.label;
    setGcalAssignments((prev) => {
      const cur = prev[key] ?? {};
      return {
        ...prev,
        [key]: {
          ...(cur.projectId !== undefined ? { projectId: cur.projectId } : {}),
          hidden: true as const,
          summary,
        },
      };
    });
    setError(null);
    setBlockEdit(null);
  };

  // シリーズ全体を非表示にする (明示操作)。 popup の小さなリンクから呼び出し
  const hideGcalSeriesFromEdit = (): void => {
    if (blockEdit === null || blockEdit.source !== 'gcal' || blockEdit.gcalKey === undefined) return;
    const key = blockEdit.gcalKey;
    const summary = blockEdit.label;
    if (!window.confirm(`「${summary}」と同名の予定をすべて非表示にします。よろしいですか？\n(設定の「同名予定ルール」から元に戻せます)`)) return;
    setGcalSummaryRules((prev) => ({ ...prev, [summary]: { hidden: true as const } }));
    setGcalAssignments((prev) => {
      if (prev[key] === undefined) return prev;
      const { [key]: _, ...rest } = prev;
      return rest;
    });
    setError(null);
    setBlockEdit(null);
  };

  const restoreGcalAssignment = (key: string): void => {
    setGcalAssignments((prev) => {
      const cur = prev[key];
      if (cur === undefined) return prev;
      const next: GcalAssignment = {
        ...(cur.projectId !== undefined ? { projectId: cur.projectId } : {}),
        ...(cur.summary !== undefined ? { summary: cur.summary } : {}),
        // hidden を取り除く
      };
      if (next.projectId === undefined && next.summary === undefined) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: next };
    });
  };

  const submitNewProject = (): void => {
    const trimmed = newProjectName.trim();
    if (trimmed.length === 0) return;
    const budgetStr = newProjectBudget.trim();
    const parsed = budgetStr.length > 0 ? parseFloat(budgetStr) : NaN;
    const hasBudget = Number.isFinite(parsed) && parsed >= 0;
    setProjects((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: trimmed,
        color: newProjectColor,
        ...(hasBudget ? { monthlyBudget: parsed } : {}),
      },
    ]);
    setNewProjectName('');
    setNewProjectBudget('');
  };

  const beginEditMonthBudget = (projectId: string, currentValue: number | undefined): void => {
    setEditingMonthBudgetProjectId(projectId);
    setEditingMonthBudgetValue(currentValue !== undefined ? String(currentValue) : '');
  };

  const cancelEditMonthBudget = (): void => {
    setEditingMonthBudgetProjectId(null);
    setEditingMonthBudgetValue('');
  };

  const saveMonthBudgetOverride = (projectId: string, ym: string): void => {
    const trimmed = editingMonthBudgetValue.trim();
    if (trimmed === '') return;
    const num = parseFloat(trimmed);
    if (!Number.isFinite(num) || num < 0) return;
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        const existing = p.monthlyBudgetOverrides ?? {};
        return { ...p, monthlyBudgetOverrides: { ...existing, [ym]: num } };
      }),
    );
    cancelEditMonthBudget();
  };

  const clearMonthBudgetOverride = (projectId: string, ym: string): void => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        if (p.monthlyBudgetOverrides === undefined) return p;
        const next = { ...p.monthlyBudgetOverrides };
        delete next[ym];
        if (Object.keys(next).length === 0) {
          return {
            id: p.id,
            name: p.name,
            color: p.color,
            ...(p.monthlyBudget !== undefined ? { monthlyBudget: p.monthlyBudget } : {}),
          };
        }
        return { ...p, monthlyBudgetOverrides: next };
      }),
    );
    cancelEditMonthBudget();
  };

  const updateProjectBudget = (id: string, value: string): void => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const trimmed = value.trim();
        if (trimmed === '') {
          return { id: p.id, name: p.name, color: p.color };
        }
        const num = parseFloat(trimmed);
        if (!Number.isFinite(num) || num < 0) return p;
        return { ...p, monthlyBudget: num };
      }),
    );
  };

  const renameProject = (id: string, name: string): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
  };

  const recolorProject = (id: string, color: string): void => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, color } : p)));
  };

  const closeSettings = (): void => {
    setShowSettings(false);
    setColorPickerProjectId(null);
    setColorPickerTemplateId(null);
    setSettingsView('menu');
  };

  const openSettings = (): void => {
    setSettingsView('menu');
    setShowSettings(true);
  };

  const handleDeleteProject = (id: string): void => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setBlocksByDate((prev) => {
      const next: Record<DateString, readonly TimeBlock[]> = {};
      for (const [date, dayBlocks] of Object.entries(prev)) {
        next[date] = dayBlocks.map((b) => (b.projectId === id ? blockWithoutProject(b) : b));
      }
      return next;
    });
    setTemplates((prev) =>
      prev.map((t) => (t.projectId === id ? templateWithoutProject(t) : t)),
    );
  };

  const submitNewTemplate = (): void => {
    const trimmed = newTemplateLabel.trim();
    if (trimmed.length === 0) return;
    const dur = parseInt(newTemplateDuration, 10);
    if (!Number.isFinite(dur) || dur <= 0 || dur > 1440) return;
    setTemplates((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label: trimmed,
        defaultDurationMin: dur,
        color: newTemplateColor,
        ...(newTemplateProjectId !== '' ? { projectId: newTemplateProjectId } : {}),
      },
    ]);
    setNewTemplateLabel('');
    setNewTemplateDuration('30');
    setNewTemplateProjectId('');
  };

  const renameTemplate = (id: string, label: string): void => {
    const trimmed = label.trim();
    if (trimmed.length === 0) return;
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, label: trimmed } : t)));
  };

  const updateTemplateDuration = (id: string, value: string): void => {
    const trimmed = value.trim();
    if (trimmed === '') return;
    const num = parseInt(trimmed, 10);
    if (!Number.isFinite(num) || num <= 0 || num > 1440) return;
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, defaultDurationMin: num } : t)));
  };

  const updateTemplateProject = (id: string, projectId: string): void => {
    setTemplates((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (projectId === '') return templateWithoutProject(t);
        return { ...t, projectId };
      }),
    );
  };

  const recolorTemplate = (id: string, color: string): void => {
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, color } : t)));
  };

  const handleDeleteTemplate = (id: string): void => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    setBlocksByDate((prev) => {
      const next: Record<DateString, readonly TimeBlock[]> = {};
      for (const [date, dayBlocks] of Object.entries(prev)) {
        next[date] = dayBlocks.map((b) => (b.templateId === id ? blockWithoutTemplate(b) : b));
      }
      return next;
    });
  };

  const navigateToDate = (date: DateString, mode: ViewMode = viewMode): void => {
    if (blockEdit !== null) closeBlockEdit();
    setError(null);
    setCurrentDate(date);
    setViewMode(mode);
  };

  const handleImport = async (): Promise<void> => {
    setImportStatus('importing');
    setImportError(null);
    try {
      const state = await importStoreFromJson(importText);
      setBlocksByDate(state.blocksByDate);
      setProjects(state.projects);
      setTemplates(state.templates);
      setGcalAssignments(state.gcalAssignments);
      setGcalSummaryRules(state.gcalSummaryRules);
      setImportStatus('success');
      setImportText('');
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
      setImportStatus('error');
    }
  };

  const isToday = currentDate === today();

  const headerDateLabel = ((): string => {
    if (viewMode === 'day') return formatJaDate(currentDate);
    if (viewMode === 'week') {
      const days = daysOfWeek(currentDate);
      const start = days[0] as DateString;
      const end = days[6] as DateString;
      return `${formatJaDate(start)} – ${formatJaDate(end).split(' ')[0]}`;
    }
    if (viewMode === 'month') return formatJaYearMonth(yearMonthOf(currentDate));
    return `${yearOf(currentDate)}年`;
  })();

  if (loadStatus === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        読み込み中…
      </div>
    );
  }
  if (loadStatus === 'error') {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md">
          <div className="text-destructive font-semibold mb-2">読み込みエラー</div>
          <div className="text-muted-foreground text-sm mb-4">{loadError ?? '不明なエラー'}</div>
          <Button onClick={() => location.reload()}>再読み込み</Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'h-screen grid bg-background text-foreground',
        'transition-[grid-template-columns] duration-[280ms] ease-emphasis',
        sidebarCollapsed ? 'grid-cols-[0px_1fr]' : 'grid-cols-[240px_1fr]',
      )}
    >
      <aside
        aria-hidden={sidebarCollapsed}
        className={cn(
          'bg-muted/40 border-r overflow-hidden',
          'transition-[transform,opacity] duration-[280ms] ease-emphasis',
          sidebarCollapsed && '-translate-x-2 opacity-0 pointer-events-none',
        )}
      >
        <div className="w-[240px] h-full overflow-auto p-4">
          <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-2">
            テンプレート
          </h2>
          {templates.length === 0 && (
            <div className="text-[11px] text-muted-foreground/70 px-1.5 py-1">
              テンプレート未登録
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {templates.map((t) => {
              const proj = t.projectId !== undefined ? projectById.get(t.projectId) : undefined;
              const accent = proj?.color ?? t.color ?? '#94a3b8';
              const dragEnabled = viewMode === 'day';
              return (
                <div
                  key={t.id}
                  draggable={dragEnabled}
                  onDragStart={(e) => handleTemplateDragStart(e, t.id)}
                  title={dragEnabled ? undefined : '日ビューで配置できます'}
                  className={cn(
                    'bg-card border rounded-md text-[13px] select-none',
                    'pl-2.5 pr-2.5 py-2 transition-shadow',
                    dragEnabled
                      ? 'cursor-grab hover:shadow-sm'
                      : 'cursor-default opacity-50',
                  )}
                  style={{
                    borderLeft: `4px solid ${accent}`,
                    boxShadow: 'var(--shadow-soft)',
                  }}
                >
                  <div className="leading-tight">{t.label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {t.defaultDurationMin}分{proj !== undefined && ` · ${proj.name}`}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground/80 mt-5 leading-relaxed">
            ・テンプレを D&amp;D で配置<br />
            ・空き時間ダブルクリックで自由記入<br />
            ・設置済みブロックもドラッグで移動<br />
            ・ブロックをダブルクリックで編集
          </p>
        </div>
      </aside>

      <main className="flex flex-col overflow-hidden">
        <header className="flex items-center gap-4 border-b bg-card/80 backdrop-blur-sm px-4 py-2.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSidebarCollapsed((c) => !c)}
            title={sidebarCollapsed ? 'サイドバーを表示' : 'サイドバーを隠す'}
            aria-label="サイドバー切替"
          >
            {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => navigateToDate(shiftViewDate(currentDate, viewMode, -1))}
              title="前へ"
              aria-label="前へ"
            >
              <ChevronLeft />
            </Button>
            <span className="text-sm min-w-[220px] text-center text-foreground font-semibold">
              {headerDateLabel}
              {isToday && viewMode === 'day' && (
                <span className="ml-1.5 text-[10px] text-primary">(今日)</span>
              )}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => navigateToDate(shiftViewDate(currentDate, viewMode, 1))}
              title="次へ"
              aria-label="次へ"
            >
              <ChevronRight />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigateToDate(today())}
              disabled={isToday && viewMode === 'day'}
              title="今日へジャンプ"
              className="ml-1.5"
            >
              今日
            </Button>
          </div>

          <div className="flex items-center -space-x-px ml-2">
            {(['day', 'week', 'month', 'year'] as const).map((m, i) => {
              const active = viewMode === m;
              const label = m === 'day' ? '日' : m === 'week' ? '週' : m === 'month' ? '月' : '年';
              return (
                <button
                  key={m}
                  onClick={() => navigateToDate(currentDate, m)}
                  className={cn(
                    'border px-3 py-1 text-xs transition-colors cursor-pointer',
                    i === 0 && 'rounded-l-md',
                    i === 3 && 'rounded-r-md',
                    active
                      ? 'bg-foreground text-background border-foreground z-10 font-semibold'
                      : 'bg-card text-foreground border-border hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="flex-1" />
          {error !== null && (
            <span className="text-destructive text-xs">{error}</span>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowSummary(true)}
            title={`${formatJaYearMonth(yearMonthOf(currentDate))}のサマリー (S)`}
            aria-label="月次サマリー"
          >
            <BarChart3 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowKeyboardHelp(true)}
            title="キーボードショートカット (?)"
            aria-label="キーボードショートカット"
          >
            <Keyboard />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={openSettings}
            title={`設定 (${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'} ,)`}
            aria-label="設定"
          >
            <Settings2 />
          </Button>
        </header>

        {viewMode === 'day' && (
          <DayView
            currentDate={currentDate}
            blocks={blocks}
            setBlocks={setBlocks}
            blocksByDate={mergedBlocksByDate}
            projects={projects}
            projectById={projectById}
            templateById={templateById}
            setError={setError}
            openBlockEdit={openBlockEdit}
          />
        )}
        {viewMode === 'week' && (
          <WeekView
            currentDate={currentDate}
            blocksByDate={mergedBlocksByDate}
            projectById={projectById}
            onDayClick={(d) => navigateToDate(d, 'day')}
          />
        )}
        {viewMode === 'month' && (
          <MonthView
            currentDate={currentDate}
            blocksByDate={mergedBlocksByDate}
            projects={projects}
            projectById={projectById}
            onDayClick={(d) => navigateToDate(d, 'day')}
          />
        )}
        {viewMode === 'year' && (
          <YearView
            currentDate={currentDate}
            blocksByDate={mergedBlocksByDate}
            projects={projects}
            projectById={projectById}
            onMonthClick={(ym) => navigateToDate(`${ym}-01`, 'month')}
          />
        )}
      </main>

      <Dialog open={showSettings} onOpenChange={(open) => { if (!open) closeSettings(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1 text-base">
              {settingsView !== 'menu' && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setSettingsView('menu')}
                  aria-label="戻る"
                  title="設定メニューへ戻る"
                  className="-ml-1"
                >
                  <ChevronLeft />
                </Button>
              )}
              <span>{SETTINGS_TITLES[settingsView]}</span>
            </DialogTitle>
          </DialogHeader>

          {settingsView === 'menu' && (
            <div className="flex flex-col gap-2">
              {[
                { key: 'general' as const, label: '一般', desc: '通知音などのアプリ全体の設定' },
                { key: 'projects' as const, label: '案件設定', desc: '案件の追加・編集・削除、月予算' },
                { key: 'templates' as const, label: 'テンプレート設定', desc: 'ドラッグ用テンプレの管理' },
                { key: 'gcal' as const, label: 'Google Calendar 連携', desc: '打ち合わせ予定を取り込んで工数集計に含める' },
                { key: 'data' as const, label: 'データ移行', desc: 'ブラウザ localStorage から JSON で取り込み（上書き）' },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSettingsView(item.key)}
                  className="flex items-center justify-between gap-3 px-3.5 py-3 bg-card border border-border rounded-md cursor-pointer text-left text-foreground transition-colors hover:bg-accent/40 hover:border-border"
                >
                  <div>
                    <div className="text-[13px] font-semibold">{item.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}

          {settingsView === 'general' && (
            <div className="flex flex-col gap-5">
              <div>
                <Label className="text-[11px] text-muted-foreground flex items-center gap-1.5 mb-2">
                  <Bell className="size-3" /> 通知音
                </Label>
                <div className="flex items-center gap-2">
                  <Select
                    value={selectedSoundId}
                    onValueChange={(v) => setSelectedSoundId(v)}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SOUNDS.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => previewSound(selectedSoundId)}
                    disabled={selectedSoundId === 'silent'}
                  >
                    試聴
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                  自前の音を追加するには、ファイルを{' '}
                  <code className="bg-muted px-1 rounded">public/sounds/</code> に置いて{' '}
                  <code className="bg-muted px-1 rounded">src/sounds.ts</code>{' '}
                  に登録してくださいませ。詳細は同ディレクトリ内 README に。
                </p>
              </div>
            </div>
          )}

          {settingsView === 'projects' && (
            <>
              <div className="mb-4">
                {projects.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">案件が登録されておりません</div>
                ) : (
                  projects.map((p) => {
                    const pickerOpen = colorPickerProjectId === p.id;
                    return (
                      <div key={p.id} className="py-2 border-b border-border/60">
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => setColorPickerProjectId(pickerOpen ? null : p.id)}
                            title="色を変更"
                            aria-label="色を変更"
                            className={cn(
                              'w-[18px] h-[18px] rounded shrink-0 cursor-pointer p-0 transition-shadow',
                              pickerOpen ? 'ring-2 ring-foreground ring-offset-1' : 'border border-foreground/10',
                            )}
                            style={{ background: p.color }}
                          />
                          <Input
                            value={p.name}
                            onChange={(e) => renameProject(p.id, e.currentTarget.value)}
                            placeholder="案件名"
                            className="flex-1 h-8 text-[13px]"
                          />
                          <Input
                            type="number"
                            step={0.05}
                            min={0}
                            value={p.monthlyBudget ?? ''}
                            onChange={(e) => updateProjectBudget(p.id, e.currentTarget.value)}
                            placeholder="人月"
                            title="月予算 (人月)"
                            className="w-[70px] h-8 text-xs"
                          />
                          <Button
                            size="xs"
                            variant="destructive"
                            onClick={() => handleDeleteProject(p.id)}
                          >
                            削除
                          </Button>
                        </div>
                        {pickerOpen && (
                          <div className="flex gap-1.5 mt-2 pl-7 flex-wrap">
                            {PROJECT_COLOR_PALETTE.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => {
                                  recolorProject(p.id, c);
                                  setColorPickerProjectId(null);
                                }}
                                title={c}
                                className={cn(
                                  'w-[22px] h-[22px] rounded cursor-pointer p-0 transition-all',
                                  p.color === c ? 'ring-2 ring-foreground ring-offset-1' : 'hover:ring-2 hover:ring-foreground/30 hover:ring-offset-1',
                                )}
                                style={{ background: c }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="border-t border-border/60 pt-3.5 space-y-2">
                <div className="text-xs text-foreground/85 font-semibold">新しい案件を追加</div>
                <Input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitNewProject();
                  }}
                  placeholder="案件名"
                />
                <Input
                  type="number"
                  step={0.05}
                  min={0}
                  value={newProjectBudget}
                  onChange={(e) => setNewProjectBudget(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitNewProject();
                  }}
                  placeholder="月予算 (人月、任意)"
                />
                <div className="flex gap-1.5 flex-wrap">
                  {PROJECT_COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewProjectColor(c)}
                      title={c}
                      className={cn(
                        'w-[22px] h-[22px] rounded cursor-pointer p-0 transition-all',
                        newProjectColor === c ? 'ring-2 ring-foreground ring-offset-1' : 'hover:ring-2 hover:ring-foreground/30 hover:ring-offset-1',
                      )}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <Button
                  onClick={submitNewProject}
                  disabled={newProjectName.trim().length === 0}
                  className="w-full"
                >
                  <Plus />
                  追加
                </Button>
              </div>
            </>
          )}

          {settingsView === 'templates' && (
            <>
              <div className="mb-4">
                {templates.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">テンプレートが登録されておりません</div>
                ) : (
                  templates.map((t) => {
                    const pickerOpen = colorPickerTemplateId === t.id;
                    const swatchColor = t.color ?? (t.projectId !== undefined ? projectById.get(t.projectId)?.color : undefined) ?? '#A39A92';
                    return (
                      <div key={t.id} className="py-2 border-b border-border/60">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setColorPickerTemplateId(pickerOpen ? null : t.id)}
                            title="色を変更"
                            aria-label="色を変更"
                            className={cn(
                              'w-[18px] h-[18px] rounded shrink-0 cursor-pointer p-0 transition-shadow',
                              pickerOpen ? 'ring-2 ring-foreground ring-offset-1' : 'border border-foreground/10',
                            )}
                            style={{ background: swatchColor }}
                          />
                          <Input
                            value={t.label}
                            onChange={(e) => renameTemplate(t.id, e.currentTarget.value)}
                            placeholder="ラベル"
                            className="flex-1 h-8 text-[13px]"
                          />
                          <Input
                            type="number"
                            min={1}
                            max={1440}
                            step={5}
                            value={t.defaultDurationMin}
                            onChange={(e) => updateTemplateDuration(t.id, e.currentTarget.value)}
                            title="既定時間 (分)"
                            className="w-16 h-8 text-xs"
                          />
                          <Select
                            value={t.projectId ?? '__unassigned__'}
                            onValueChange={(v) => updateTemplateProject(t.id, v === '__unassigned__' ? '' : v)}
                          >
                            <SelectTrigger className="max-w-[120px] h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__unassigned__">— 未割当 —</SelectItem>
                              {projects.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="xs"
                            variant="destructive"
                            onClick={() => handleDeleteTemplate(t.id)}
                          >
                            削除
                          </Button>
                        </div>
                        {pickerOpen && (
                          <div className="flex gap-1.5 mt-2 pl-7 flex-wrap">
                            {PROJECT_COLOR_PALETTE.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => {
                                  recolorTemplate(t.id, c);
                                  setColorPickerTemplateId(null);
                                }}
                                title={c}
                                className={cn(
                                  'w-[22px] h-[22px] rounded cursor-pointer p-0 transition-all',
                                  t.color === c ? 'ring-2 ring-foreground ring-offset-1' : 'hover:ring-2 hover:ring-foreground/30 hover:ring-offset-1',
                                )}
                                style={{ background: c }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="border-t border-border/60 pt-3.5 space-y-2">
                <div className="text-xs text-foreground/85 font-semibold">新しいテンプレートを追加</div>
                <Input
                  value={newTemplateLabel}
                  onChange={(e) => setNewTemplateLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitNewTemplate();
                  }}
                  placeholder="ラベル (例: ☕ コーヒー)"
                />
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    step={5}
                    value={newTemplateDuration}
                    onChange={(e) => setNewTemplateDuration(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitNewTemplate();
                    }}
                    placeholder="分"
                    title="既定時間 (分)"
                    className="w-20"
                  />
                  <Select
                    value={newTemplateProjectId === '' ? '__unassigned__' : newTemplateProjectId}
                    onValueChange={(v) => setNewTemplateProjectId(v === '__unassigned__' ? '' : v)}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unassigned__">— 案件未割当 —</SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {PROJECT_COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewTemplateColor(c)}
                      title={c}
                      className={cn(
                        'w-[22px] h-[22px] rounded cursor-pointer p-0 transition-all',
                        newTemplateColor === c ? 'ring-2 ring-foreground ring-offset-1' : 'hover:ring-2 hover:ring-foreground/30 hover:ring-offset-1',
                      )}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <Button
                  onClick={submitNewTemplate}
                  disabled={newTemplateLabel.trim().length === 0}
                  className="w-full"
                >
                  <Plus />
                  追加
                </Button>
              </div>
            </>
          )}

          {settingsView === 'gcal' && (
            <div>
              <div className="text-xs text-foreground/85 leading-relaxed mb-3.5">
                Google Calendar の予定を読み取り専用で取り込みます。<br/>
                打ち合わせ等の予定に案件を割り当てて、工数集計に含められます。
              </div>

              {gcalAuth.status === 'unconfigured' && (
                <div className="px-3.5 py-3 rounded-md text-xs leading-relaxed" style={{ background: '#F0E5D0', border: '1px solid #E0CFA8', color: '#7A5530' }}>
                  <div className="font-semibold mb-1.5">Client ID が未設定です</div>
                  <div>
                    Google Cloud Console で OAuth 2.0 クライアント ID を発行し、<br/>
                    プロジェクトルートに <code className="bg-card px-1.5 py-px rounded text-[10px]">.env.local</code> を作成して下記を記述してください:
                  </div>
                  <pre className="mt-2 px-2.5 py-2 bg-card rounded text-[11px] overflow-x-auto" style={{ border: '1px solid #E0CFA8' }}>VITE_GOOGLE_CLIENT_ID=xxxxxxx.apps.googleusercontent.com</pre>
                  <div className="mt-1.5 text-[11px]">
                    設定後 dev サーバを再起動してください。
                  </div>
                </div>
              )}

              {gcalAuth.status !== 'unconfigured' && (
                <div className="px-3.5 py-3 bg-muted/40 border rounded-md">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{
                          background:
                            gcalAuth.status === 'connected' ? '#7FA384'
                            : gcalAuth.status === 'connecting' ? '#C29050'
                            : gcalAuth.status === 'error' ? '#B85C5C'
                            : gcalAuth.status === 'loading' ? '#B5B0A8'
                            : '#D1CDC6',
                        }}
                      />
                      <div className="text-[13px] font-semibold text-foreground">
                        {gcalAuth.status === 'connected' && '接続済み'}
                        {gcalAuth.status === 'connecting' && '接続中…'}
                        {gcalAuth.status === 'disconnected' && '未接続'}
                        {gcalAuth.status === 'loading' && '読み込み中…'}
                        {gcalAuth.status === 'error' && 'エラー'}
                      </div>
                    </div>
                    {gcalAuth.status === 'connected' ? (
                      <Button size="sm" variant="outline" onClick={gcalAuth.disconnect}>
                        切断
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={gcalAuth.connect}
                        disabled={gcalAuth.status === 'loading' || gcalAuth.status === 'connecting'}
                      >
                        Google で接続
                      </Button>
                    )}
                  </div>

                  {gcalAuth.errorMessage !== null && (
                    <div className="mt-2.5 text-[11px]" style={{ color: '#B85C5C' }}>
                      {gcalAuth.errorMessage}
                    </div>
                  )}

                  {gcalAuth.status === 'connected' && (
                    <>
                      <div className="mt-2.5 text-[11px] text-muted-foreground leading-relaxed">
                        スコープ: 読み取り専用 (calendar.readonly)<br/>
                        アクセストークンはメモリ保持。リロード後は popup なしで自動再接続を試みます (Google 側の session 切れ時のみ手動接続が必要)。
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-border/60">
                        <div className="text-xs font-semibold text-foreground/85 mb-1.5">
                          同期するカレンダー
                        </div>
                        {gcalCalendars.status === 'loading' && (
                          <div className="text-[11px] text-muted-foreground">カレンダー一覧を読み込み中…</div>
                        )}
                        {gcalCalendars.status === 'error' && (
                          <div className="text-[11px]" style={{ color: '#B85C5C' }}>
                            カレンダー一覧取得エラー: {gcalCalendars.errorMessage}
                          </div>
                        )}
                        {gcalCalendars.status === 'loaded' && (
                          <>
                            <Select
                              value={selectedCalendarId ?? '__none__'}
                              onValueChange={(v) => setSelectedCalendarId(v === '__none__' ? null : v)}
                            >
                              <SelectTrigger className="w-full text-xs">
                                <SelectValue placeholder="同期するカレンダーを選択" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">— 同期するカレンダーを選択 —</SelectItem>
                                {gcalCalendars.calendars.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.isPrimary ? '★ ' : ''}{c.displayName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {selectedCalendarId !== null && !gcalCalendars.calendars.some((c) => c.id === selectedCalendarId) && (
                              <div className="mt-1.5 text-[11px]" style={{ color: '#A0623A' }}>
                                ⚠ 前回選択していたカレンダーが見つかりません。再選択してください。
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-border/60">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs text-foreground/85">
                            {gcalSync.status === 'syncing' && '同期中…'}
                            {gcalSync.status === 'idle' && gcalSync.lastSyncedAt !== null && (
                              <>最終同期: {new Date(gcalSync.lastSyncedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</>
                            )}
                            {gcalSync.status === 'idle' && gcalSync.lastSyncedAt === null && '未同期'}
                            {gcalSync.status === 'error' && (
                              <span style={{ color: '#B85C5C' }}>同期エラー</span>
                            )}
                          </div>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={gcalSync.refresh}
                            disabled={gcalSync.status === 'syncing'}
                          >
                            再同期
                          </Button>
                        </div>
                        {gcalSync.status === 'error' && (
                          <div className="mt-2 px-2.5 py-2 rounded text-[11px] leading-relaxed" style={{ background: '#EFD6D6', border: '1px solid #DEBABA', color: '#7A3838' }}>
                            {gcalSync.errorStatus === 401 || gcalSync.errorStatus === 403 ? (
                              <>
                                <div className="font-semibold">セッションが切れています</div>
                                <div>自動再接続が失敗しました。下の「Google で接続」ボタンを押して再認証してください。</div>
                              </>
                            ) : gcalSync.errorStatus === 429 ? (
                              <>
                                <div className="font-semibold">API リクエスト制限</div>
                                <div>しばらく待ってから再同期ボタンを押してくださいまし。</div>
                              </>
                            ) : gcalSync.errorStatus !== null && gcalSync.errorStatus >= 500 ? (
                              <>
                                <div className="font-semibold">Google 側のサーバエラー</div>
                                <div>少し時間を置いて再同期してください ({gcalSync.errorStatus})</div>
                              </>
                            ) : (
                              <>
                                <div className="font-semibold">同期エラー</div>
                                <div>{gcalSync.errorMessage ?? 'ネットワーク接続をご確認くださいまし'}</div>
                              </>
                            )}
                          </div>
                        )}
                        <div className="mt-1.5 text-[11px] text-muted-foreground/80 leading-relaxed">
                          {selectedCalendarId === null
                            ? '※ カレンダーを選択すると表示中月 ±1ヶ月の予定を取得します'
                            : '選択カレンダーの表示中月 ±1ヶ月を取得しています'}
                        </div>
                      </div>

                      {(() => {
                        const hidden = Object.entries(gcalAssignments).filter(([, a]) => a.hidden === true);
                        if (hidden.length === 0) return null;
                        return (
                          <div className="mt-3 pt-2.5 border-t border-border/60">
                            <div className="text-xs font-semibold text-foreground/85 mb-1.5">
                              非表示中のイベント ({hidden.length})
                            </div>
                            <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
                              {hidden.map(([key, a]) => (
                                <div key={key} className="flex items-center gap-2 px-1.5 py-1 bg-card border border-border/40 rounded text-[11px]">
                                  <span className="flex-1 text-foreground/85 truncate">
                                    {a.summary ?? '(タイトル不明)'}
                                  </span>
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    onClick={() => restoreGcalAssignment(key)}
                                  >
                                    再表示
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {(() => {
                        const rules = Object.entries(gcalSummaryRules);
                        if (rules.length === 0) return null;
                        return (
                          <div className="mt-3 pt-2.5 border-t border-border/60">
                            <div className="text-xs font-semibold text-foreground/85 mb-1.5">
                              同名予定ルール ({rules.length})
                            </div>
                            <div className="max-h-52 overflow-y-auto flex flex-col gap-1">
                              {rules.map(([summary, r]) => {
                                const proj = r.projectId !== undefined ? projectById.get(r.projectId) : undefined;
                                return (
                                  <div key={summary} className="flex items-center gap-2 px-1.5 py-1 bg-card border border-border/40 rounded text-[11px]">
                                    <span className="flex-1 text-foreground/85 truncate">
                                      {summary}
                                    </span>
                                    <span
                                      className="text-[10px] px-1.5 py-px rounded whitespace-nowrap"
                                      style={{
                                        background: r.hidden === true ? '#F0E5D0' : (proj?.color ?? 'var(--muted)'),
                                        color: r.hidden === true ? '#7A5530' : 'white',
                                      }}
                                    >
                                      {r.hidden === true ? '非表示' : (proj?.name ?? '未割当')}
                                    </span>
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      onClick={() => setGcalSummaryRules((prev) => {
                                        const { [summary]: _omit, ...rest } = prev;
                                        return rest;
                                      })}
                                    >
                                      削除
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {settingsView === 'data' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                ブラウザ (Chrome 等) で動かしていた taskette の localStorage を取り込みます。
                ブラウザの DevTools コンソールで以下を実行してクリップボードにコピーし、下のテキスト欄に貼り付けてくださいませ。
              </p>
              <pre className="text-[11px] bg-muted px-3 py-2 rounded-md overflow-x-auto font-mono">{`copy(localStorage.getItem('taskette/v1'))`}</pre>
              <Label htmlFor="import-textarea" className="text-xs">JSON ペースト欄</Label>
              <textarea
                id="import-textarea"
                className="w-full min-h-32 p-2 text-xs font-mono border border-border rounded-md bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder='{"version":1,"blocksByDate":{...},"projects":[...],...}'
              />
              <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                ⚠ 取り込みは現在のデータをすべて上書きしますの。元には戻せません。
              </div>
              {importError !== null && (
                <div className="text-xs text-destructive">エラー: {importError}</div>
              )}
              {importStatus === 'success' && (
                <div className="text-xs text-emerald-600">取り込み完了しましたわ。</div>
              )}
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setImportText('');
                    setImportError(null);
                    setImportStatus('idle');
                  }}
                  disabled={importStatus === 'importing'}
                >
                  クリア
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    void handleImport();
                  }}
                  disabled={importText.trim().length === 0 || importStatus === 'importing'}
                >
                  {importStatus === 'importing' ? '取り込み中…' : '取り込む（上書き）'}
                </Button>
              </div>
              {!isUsingTauriBackend() && (
                <div className="text-[11px] text-muted-foreground border-t pt-2 mt-2">
                  現在はブラウザ環境ですので、取り込み先も localStorage です。Tauri アプリで実行すれば SQLite に書き込まれますの。
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showSummary} onOpenChange={setShowSummary}>
        <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-auto">
          {(() => {
            const ym = yearMonthOf(currentDate);
            const aggregate = aggregateMonthly(mergedBlocksByDate, ym);
            const elapsed = elapsedRatio(ym);
            const totalAssignedMin = Array.from(aggregate.byProject.values()).reduce((a, b) => a + b, 0);
            const grandTotalMin = totalAssignedMin + aggregate.unassigned;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{formatJaYearMonth(ym)}のサマリー</DialogTitle>
                </DialogHeader>

                {projects.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">案件が登録されておりません</div>
                ) : (
                  <div className="flex flex-col gap-3.5">
                    {projects.map((p) => {
                      const minutes = aggregate.byProject.get(p.id) ?? 0;
                      const u = projectBudgetUsage(p, minutes, elapsed, ym);
                      const effectivePM = effectiveBudgetPM(p, ym);
                      const hasOverride = p.monthlyBudgetOverrides?.[ym] !== undefined;
                      const isEditingThis = editingMonthBudgetProjectId === p.id;
                      const barColor = u.status === 'over'
                        ? '#B85C5C'
                        : u.status === 'projectedOver'
                          ? '#C58054'
                          : (u.status === 'projectedUnder' || u.status === 'underConfirmed')
                            ? '#C29050'
                            : p.color;
                      return (
                        <div key={p.id}>
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="w-2.5 h-2.5 rounded-[2px] shrink-0"
                              style={{ background: p.color }}
                            />
                            <span className="text-[13px] flex-1 text-foreground">{p.name}</span>
                            <span className="text-xs text-foreground/85">
                              {u.actualPM.toFixed(2)}人月 ({u.actualH.toFixed(1)}h)
                              {effectivePM !== undefined && (
                                <span className="text-muted-foreground">
                                  {' / '}{effectivePM}人月 ({Math.round(u.ratio * 100)}%)
                                  {hasOverride && (
                                    <span className="ml-1 text-[10px] font-semibold text-primary">(今月のみ)</span>
                                  )}
                                </span>
                              )}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => isEditingThis ? cancelEditMonthBudget() : beginEditMonthBudget(p.id, effectivePM)}
                              title="今月の予算を変更"
                              aria-label="今月の予算を変更"
                              className={cn(isEditingThis && 'text-primary')}
                            >
                              <Pencil />
                            </Button>
                          </div>
                          {isEditingThis && (
                            <div className="flex gap-1.5 mb-2 pl-4 items-center flex-wrap">
                              <Input
                                type="number"
                                step={0.05}
                                min={0}
                                value={editingMonthBudgetValue}
                                onChange={(e) => setEditingMonthBudgetValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveMonthBudgetOverride(p.id, ym);
                                  else if (e.key === 'Escape') cancelEditMonthBudget();
                                }}
                                autoFocus
                                placeholder="人月"
                                className="w-20 h-7 text-xs"
                              />
                              <Button
                                size="xs"
                                onClick={() => saveMonthBudgetOverride(p.id, ym)}
                                disabled={editingMonthBudgetValue.trim() === ''}
                              >
                                保存
                              </Button>
                              {hasOverride && (
                                <Button
                                  size="xs"
                                  variant="destructive"
                                  onClick={() => clearMonthBudgetOverride(p.id, ym)}
                                  title="今月のオーバーライドを解除して通常の予算に戻す"
                                >
                                  解除
                                </Button>
                              )}
                              <Button size="xs" variant="outline" onClick={cancelEditMonthBudget}>
                                キャンセル
                              </Button>
                            </div>
                          )}
                          {u.budgetH !== null && (
                            <div className="h-1.5 bg-muted rounded-[3px] overflow-hidden">
                              <div
                                className="h-full transition-[width] duration-200"
                                style={{ width: `${u.barFraction * 100}%`, background: barColor }}
                              />
                            </div>
                          )}
                          {u.budgetH !== null && u.lowH !== null && u.highH !== null && (
                            <div className="text-[11px] text-muted-foreground mt-1">
                              許容 {fmtH(u.lowH)}h–{fmtH(u.highH)}h（±{fmtH(u.toleranceH)}h）
                            </div>
                          )}
                          {u.status === 'over' && u.highH !== null && (
                            <div className="text-[11px] mt-0.5" style={{ color: '#B85C5C' }}>
                              ⚠ 超過 ({(u.actualH - u.highH).toFixed(1)}h オーバー)
                            </div>
                          )}
                          {u.status === 'underConfirmed' && u.lowH !== null && (
                            <div className="text-[11px] mt-0.5" style={{ color: '#8E6230' }}>
                              ⚠ 不足 ({(u.lowH - u.actualH).toFixed(1)}h 不足、月末確定)
                            </div>
                          )}
                          {u.status === 'projectedOver' && u.projection !== null && (
                            <div className="text-[11px] mt-0.5" style={{ color: '#A0623A' }}>
                              ⚠ このままだと月末予測 {u.projection.toFixed(1)}h（許容を超過する見込み）
                            </div>
                          )}
                          {u.status === 'projectedUnder' && u.projection !== null && (
                            <div className="text-[11px] mt-0.5" style={{ color: '#8E6230' }}>
                              ⚠ このままだと月末予測 {u.projection.toFixed(1)}h（許容に届かない見込み）
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="border-t border-border/60 mt-4 pt-3 text-xs text-foreground/85">
                  <div>合計実績: {(grandTotalMin / 60).toFixed(1)}h（割当: {(totalAssignedMin / 60).toFixed(1)}h, 未割当: {(aggregate.unassigned / 60).toFixed(1)}h）</div>
                  <div className="text-muted-foreground mt-1">
                    月の経過: {Math.round(elapsed * 100)}%
                  </div>
                </div>
                </>
              );
            })()}
        </DialogContent>
      </Dialog>

      <Dialog
        open={blockEdit !== null}
        onOpenChange={(open) => { if (!open) closeBlockEdit(); }}
      >
        {blockEdit !== null && (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {blockEdit.source === 'gcal' ? '📅 Google Calendar の予定' : 'ブロック編集'}
              </DialogTitle>
            </DialogHeader>

            {blockEdit.source === 'gcal' && (() => {
              const existingRule = gcalSummaryRules[blockEdit.label];
              const hasIndividual = blockEdit.gcalKey !== undefined && gcalAssignments[blockEdit.gcalKey] !== undefined;
              return (
                <div className="bg-muted rounded-md px-2.5 py-2 text-[11px] text-muted-foreground leading-relaxed">
                  時間とラベルは GCal 側で管理されています。ここでは案件割当のみ可能です。
                  {blockEdit.gcalRecurring === true && (
                    <div className="mt-1" style={{ color: '#5C7BA6' }}>
                      🔁 繰り返し予定です — 案件割当・非表示はシリーズ全体に適用されます
                    </div>
                  )}
                  {existingRule !== undefined && !hasIndividual && (
                    <div className="mt-1" style={{ color: '#8B7AB3' }}>
                      📌 同名予定ルール適用中: {existingRule.hidden === true ? '非表示' : (existingRule.projectId !== undefined ? (projectById.get(existingRule.projectId)?.name ?? '不明案件') : '未割当')}
                    </div>
                  )}
                  {existingRule !== undefined && hasIndividual && (
                    <div className="mt-1" style={{ color: '#8E6230' }}>
                      ⚠ 同名ルールはあるが、この予定は個別設定で上書きされています
                    </div>
                  )}
                </div>
              );
            })()}

            <div
              className="grid gap-4"
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                const target = e.target as HTMLElement;
                // Select の Trigger 上では Enter で開閉させたいので拾わない
                if (target.getAttribute('role') === 'combobox') return;
                e.preventDefault();
                saveBlockEdit();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="be-label" className="text-[11px] text-muted-foreground">ラベル</Label>
                <Input
                  id="be-label"
                  autoFocus={blockEdit.source !== 'gcal'}
                  disabled={blockEdit.source === 'gcal'}
                  value={blockEdit.label}
                  onChange={(e) => setBlockEdit({ ...blockEdit, label: e.target.value })}
                  onFocus={(e) => e.currentTarget.select()}
                  placeholder="ラベル"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="be-start" className="text-[11px] text-muted-foreground">開始</Label>
                  <Input
                    id="be-start"
                    type="time"
                    disabled={blockEdit.source === 'gcal'}
                    value={blockEdit.startHHMM}
                    onChange={(e) => setBlockEdit({ ...blockEdit, startHHMM: e.target.value })}
                    step={900}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="be-dur" className="text-[11px] text-muted-foreground">時間 (分)</Label>
                  <Input
                    id="be-dur"
                    type="number"
                    min={1}
                    max={1440}
                    step={5}
                    disabled={blockEdit.source === 'gcal'}
                    value={blockEdit.durationMin}
                    onChange={(e) => setBlockEdit({ ...blockEdit, durationMin: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="be-project" className="text-[11px] text-muted-foreground">案件</Label>
                <Select
                  value={blockEdit.projectId === '' ? '__unassigned__' : blockEdit.projectId}
                  onValueChange={(v) => setBlockEdit({ ...blockEdit, projectId: v === '__unassigned__' ? '' : v })}
                >
                  <SelectTrigger id="be-project" className="w-full" autoFocus={blockEdit.source === 'gcal'}>
                    <SelectValue placeholder="案件を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">— 未割当 —</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-[3px] inline-block"
                            style={{ background: p.color }}
                          />
                          {p.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {blockEdit.source === 'native' && (
                <div className="space-y-1.5">
                  <Label
                    htmlFor="be-notify"
                    className="text-[11px] text-muted-foreground flex items-center gap-1.5"
                  >
                    <Bell className="size-3" /> 通知
                  </Label>
                  <Select
                    value={blockEdit.notifyOffset === '' ? '__none__' : blockEdit.notifyOffset}
                    onValueChange={(v) => {
                      const value = v === '__none__' ? '' : v;
                      setBlockEdit({ ...blockEdit, notifyOffset: value });
                      if (value !== '') {
                        void requestNotificationPermission().then(setNotifyPermission);
                      }
                    }}
                  >
                    <SelectTrigger id="be-notify" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">通知しない</SelectItem>
                      {NOTIFY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {blockEdit.notifyOffset !== '' && notifyPermission === 'denied' && (
                    <p className="text-[11px] text-destructive">
                      通知が拒否されています。システム設定 → 通知 で taskette を許可してくださいませ。
                    </p>
                  )}
                </div>
              )}

              {blockEdit.source === 'gcal' && (
                <label className="flex items-start gap-2 text-[12px] text-foreground/85 cursor-pointer leading-relaxed">
                  <Checkbox
                    checked={editApplyToAllSameSummary}
                    onCheckedChange={(v) => setEditApplyToAllSameSummary(v === true)}
                    className="mt-0.5"
                  />
                  <span>同名予定すべてに同じ <strong>案件</strong> を適用 ({blockEdit.label.length > 22 ? `${blockEdit.label.slice(0, 22)}…` : blockEdit.label})</span>
                </label>
              )}
            </div>

            <DialogFooter className="!flex-row !justify-between sm:!justify-between gap-2">
              {blockEdit.source === 'gcal' ? (
                <Button
                  variant="outline"
                  onClick={hideGcalFromEdit}
                  title="この予定だけ taskette 上で非表示にします (GCal 側は変更されません)"
                  style={{ background: '#F0E5D0', color: '#7A5530', borderColor: '#E0CFA8' }}
                >
                  この予定のみ非表示
                </Button>
              ) : (
                <Button variant="destructive" onClick={deleteBlockFromEdit}>
                  削除
                </Button>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={closeBlockEdit}>キャンセル</Button>
                <Button onClick={saveBlockEdit}>保存</Button>
              </div>
            </DialogFooter>

            {blockEdit.source === 'gcal' && (
              <div className="pt-2 border-t border-border/60 text-right">
                <button
                  type="button"
                  onClick={hideGcalSeriesFromEdit}
                  className="text-[11px] text-muted-foreground/80 hover:text-foreground underline cursor-pointer"
                >
                  同名予定すべてを非表示にする…
                </button>
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>

      <KeyboardHelpDialog open={showKeyboardHelp} onOpenChange={setShowKeyboardHelp} />
    </div>
  );
}
