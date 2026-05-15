import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DateString, GcalAssignment, Project, ProjectEnergy, TaskTemplate, TimeBlock } from './domain/types.js';
import { isProjectActiveInMonth } from './domain/types.js';
import { Day } from './domain/day.js';
import { PROJECT_COLOR_PALETTE } from './projects.js';
import { addDays, addMonths, businessDaysRemainingInMonth, daysOfWeek, elapsedRatio, formatJaDate, formatJaYearMonth, today, yearMonthOf, yearOf } from './dates.js';
import type { ViewMode } from './views/types.js';
import { DayView } from './views/DayView.js';
import { WeekView } from './views/WeekView.js';
import { MonthView } from './views/MonthView.js';
import { YearView } from './views/YearView.js';
import { loadStore, saveStore, importStoreFromJson, isUsingTauriBackend } from './storage.js';
import { aggregateMonthly } from './domain/aggregate.js';
import { effectiveBudgetPM, projectBudgetUsage } from './domain/budget.js';
import { proposeAllocation, type ProposedBlock } from './domain/allocate.js';
import { loadFocusWindows } from './domain/focus.js';
import { useGcalAuth } from './gcal/useGcalAuth.js';
import { useGcalSync } from './gcal/useGcalSync.js';
import { useGcalCalendarList } from './gcal/useGcalCalendarList.js';
import { mergeDayBlocks } from './gcal/merge.js';
import {
  BarChart3,
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Keyboard,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import { cn, isMac } from './lib/utils.js';
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
import { HelpPanel } from './components/HelpPanel.js';
import { ReleaseNotesPanel } from './components/ReleaseNotesPanel.js';
import { UpdatesPanel } from './components/UpdatesPanel.js';
import { UpdateAvailableDialog } from './components/UpdateAvailableDialog.js';
import { DriveSyncPanel } from './components/DriveSyncPanel.js';
import { useDriveSync } from './sync/useDriveSync.js';
import { useUpdater } from './updater.js';
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

type SettingsView = 'menu' | 'general' | 'projects' | 'gcal' | 'gcal-hidden' | 'gcal-rules' | 'data' | 'updates' | 'help' | 'releases';

const SETTINGS_TITLES: Record<SettingsView, string> = {
  menu: '設定',
  general: '一般',
  projects: '案件設定',
  gcal: 'Google 連携',
  'gcal-hidden': '非表示中のイベント',
  'gcal-rules': '同名予定ルール',
  data: 'データ移行',
  updates: 'アップデート',
  help: '使い方',
  releases: 'リリースノート',
};

const settingsParent = (v: SettingsView): SettingsView => {
  if (v === 'gcal-hidden' || v === 'gcal-rules') return 'gcal';
  return 'menu';
};

const ENERGY_LABEL: Record<ProjectEnergy, string> = {
  low: '軽',
  mid: '中',
  high: '重',
};

const draftKey = (d: ProposedBlock): string =>
  `${d.date}|${d.start}|${d.end}|${d.projectId}`;

const blockWithoutProject = (b: TimeBlock): TimeBlock => ({
  id: b.id,
  label: b.label,
  start: b.start,
  durationMin: b.durationMin,
  ...(b.templateId !== undefined ? { templateId: b.templateId } : {}),
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
  // Template editing UI was removed (Slice 18+). Persisted templates are still
  // loaded so that existing blocks with templateId keep their color via templateById.
  const [templates, setTemplates] = useState<readonly TaskTemplate[]>([]);
  const [gcalAssignments, setGcalAssignments] = useState<Record<string, GcalAssignment>>({});
  const [gcalSummaryRules, setGcalSummaryRules] = useState<Record<string, { projectId?: string; hidden?: true }>>({});
  const [editApplyToAllSameSummary, setEditApplyToAllSameSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockEdit, setBlockEdit] = useState<BlockEditState | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>('menu');
  const [settingsSearch, setSettingsSearch] = useState('');
  const updater = useUpdater(true);
  const [showSummary, setShowSummary] = useState(false);
  const [proposal, setProposal] = useState<{
    drafts: readonly ProposedBlock[];
    rejected: ReadonlySet<string>;
  } | null>(null);
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
  const [activeDragProjectId, setActiveDragProjectId] = useState<string | null>(null);
  const [activeSectionExpanded, setActiveSectionExpanded] = useState(true);
  const [closedSectionExpanded, setClosedSectionExpanded] = useState(false);
  const closedExpandedBeforeDragRef = useRef<boolean | null>(null);
  const [addProjectFormOpen, setAddProjectFormOpen] = useState(false);
  const [editingMonthBudgetProjectId, setEditingMonthBudgetProjectId] = useState<string | null>(null);
  const [editingMonthBudgetValue, setEditingMonthBudgetValue] = useState('');
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<'idle' | 'importing' | 'success' | 'error'>('idle');
  const [importError, setImportError] = useState<string | null>(null);

  const gcalAuth = useGcalAuth();
  // Reload local state from SQLite after every Drive sync attempt.
  // Drive sync writes merged rows directly into the same tables that
  // App reads via loadStore — without this, the next user edit would
  // diff against pre-sync `cachedState` and silently revert remote
  // changes (Codex Critical, 22-C3 review).
  const reloadFromStorage = useCallback(async () => {
    try {
      const stored = await loadStore();
      setBlocksByDate(stored.blocksByDate);
      setProjects(stored.projects);
      setTemplates(stored.templates);
      setGcalAssignments(stored.gcalAssignments);
      setGcalSummaryRules(stored.gcalSummaryRules);
    } catch (e) {
      setError(`reload after sync: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);
  const driveSync = useDriveSync(gcalAuth, updater.appVersion ?? '0.0.0', {
    onSyncCompleted: reloadFromStorage,
  });
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

  // ----- Undo / Redo -----
  // Snapshot-based history.
  //
  // lastSnapshotRef tracks the "expected" current snapshot. We update it
  // synchronously in restoreSnapshot (so that rapid undo→redo chains see fresh
  // values before React commits) and again in the post-render effect when a
  // user-driven change is detected.
  //
  // The effect compares the just-rendered state against lastSnapshotRef:
  //   - same reference (states are immutable) → no-op (this is either the
  //     initial render after a restore, or a render that didn't touch any
  //     undoable state)
  //   - differs → user-driven change: push last onto undoStack, clear redo,
  //     update lastSnapshotRef.
  //
  // Assumes the 5 setters in restoreSnapshot batch into one render
  // (true under React 18+ event handler / async batching).
  type UndoSnapshot = {
    readonly blocksByDate: Record<DateString, readonly TimeBlock[]>;
    readonly projects: readonly Project[];
    readonly templates: readonly TaskTemplate[];
    readonly gcalAssignments: Record<string, GcalAssignment>;
    readonly gcalSummaryRules: Record<string, { projectId?: string; hidden?: true }>;
  };
  const HISTORY_LIMIT = 100;
  const undoStackRef = useRef<UndoSnapshot[]>([]);
  const redoStackRef = useRef<UndoSnapshot[]>([]);
  const lastSnapshotRef = useRef<UndoSnapshot | null>(null);
  // Create-then-edit flow: blocks created via drop/drag/double-click auto-open
  // the edit dialog. The subsequent first save should NOT push a separate
  // history entry — it should merge into the create. Otherwise a
  // create→save-without-edit produces two visually-identical history entries
  // (#1 create with default values, #2 save with same values), and the user
  // sees a "no-op" first undo.
  const inCreateEditFlowRef = useRef(false);
  const coalesceNextChangeRef = useRef(false);

  useEffect(() => {
    if (loadStatus !== 'ready') return;
    const cur: UndoSnapshot = { blocksByDate, projects, templates, gcalAssignments, gcalSummaryRules };
    const last = lastSnapshotRef.current;
    if (last === null) {
      lastSnapshotRef.current = cur;
      return;
    }
    if (
      last.blocksByDate === cur.blocksByDate &&
      last.projects === cur.projects &&
      last.templates === cur.templates &&
      last.gcalAssignments === cur.gcalAssignments &&
      last.gcalSummaryRules === cur.gcalSummaryRules
    ) return;
    if (coalesceNextChangeRef.current) {
      // Don't push 'last' onto undoStack — the existing top is already the
      // pre-create snapshot, which is the correct undo target.
      coalesceNextChangeRef.current = false;
      redoStackRef.current = [];
      lastSnapshotRef.current = cur;
      return;
    }
    undoStackRef.current.push(last);
    if (undoStackRef.current.length > HISTORY_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = [];
    lastSnapshotRef.current = cur;
  }, [loadStatus, blocksByDate, projects, templates, gcalAssignments, gcalSummaryRules]);

  const restoreSnapshot = (s: UndoSnapshot): void => {
    // Update synchronously so back-to-back undo/redo see the destination, not
    // the not-yet-committed prior value.
    lastSnapshotRef.current = s;
    setBlocksByDate(s.blocksByDate);
    setProjects(s.projects);
    setTemplates(s.templates);
    setGcalAssignments(s.gcalAssignments);
    setGcalSummaryRules(s.gcalSummaryRules);
    setError(null);
    if (blockEdit !== null) setBlockEdit(null);
  };

  const undo = (): void => {
    const prev = undoStackRef.current.pop();
    if (prev === undefined) return;
    const cur = lastSnapshotRef.current;
    if (cur !== null) redoStackRef.current.push(cur);
    restoreSnapshot(prev);
  };

  const redo = (): void => {
    const next = redoStackRef.current.pop();
    if (next === undefined) return;
    const cur = lastSnapshotRef.current;
    if (cur !== null) undoStackRef.current.push(cur);
    restoreSnapshot(next);
  };

  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;

  useNotificationScheduler(blocksByDate);

  useEffect(() => {
    void getNotificationPermission().then(setNotifyPermission);
  }, []);

  useEffect(() => {
    // Reset settings search whenever the user navigates between settings pages.
    setSettingsSearch('');
  }, [settingsView]);

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
      // Undo: Cmd/Ctrl+Z, Redo: Cmd/Ctrl+Shift+Z (or Ctrl+Y on Win/Linux)
      if (cmdOrCtrl && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redoRef.current();
        else undoRef.current();
        return;
      }
      if (cmdOrCtrl && !e.metaKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redoRef.current();
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
        case 'g':
        case 'G':
          if (viewMode === 'day' || viewMode === 'week') {
            e.preventDefault();
            runProposalRef.current();
          }
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

  const handleProjectDragStart = (e: DragEvent<HTMLDivElement>, projectId: string): void => {
    e.dataTransfer.setData('kind', 'project');
    e.dataTransfer.setData('projectId', projectId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const pinnedProjects = useMemo(() => projects.filter((p) => p.pinned), [projects]);
  // Sidebar displays pinned projects active in the currently-viewed month.
  // Ended projects auto-hide once we navigate past their endDate's month (D&D and
  // proposals shouldn't target a project that's contractually over).
  const activeSidebarProjects = useMemo(() => {
    const ym = yearMonthOf(currentDate);
    return pinnedProjects.filter((p) => isProjectActiveInMonth(p, ym));
  }, [pinnedProjects, currentDate]);

  const openBlockEdit = (block: TimeBlock, opts?: { justCreated?: boolean }): void => {
    const isGcal = block.source === 'gcal';
    // GCal block を開いた時、個別 assignment が既にある場合のみ OFF (個別設定を維持)、それ以外はデフォルト ON
    const hasIndividualAssignment = isGcal && block.gcalKey !== undefined && gcalAssignments[block.gcalKey] !== undefined;
    setEditApplyToAllSameSummary(isGcal && !hasIndividualAssignment);
    inCreateEditFlowRef.current = opts?.justCreated === true;
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
    // Cancel/Esc: don't coalesce — the create entry stays in history alone.
    inCreateEditFlowRef.current = false;
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
      setError('ラベルを入力してください');
      return;
    }
    const start = parseHHMM(blockEdit.startHHMM);
    if (start === null) {
      setError('開始時刻の形式が不正です (HH:MM)');
      return;
    }
    const dur = parseInt(blockEdit.durationMin, 10);
    if (!Number.isFinite(dur) || dur <= 0) {
      setError('時間 (分) を正の整数で入力してください');
      return;
    }
    if (start + dur > 1440) {
      setError('一日の範囲を超えています');
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
      setError(result.message);
      return;
    }

    if (inCreateEditFlowRef.current) {
      // First save after auto-open from create: merge with the create entry.
      coalesceNextChangeRef.current = true;
      inCreateEditFlowRef.current = false;
    }
    setBlocks(day.blocks);
    setError(null);
    setBlockEdit(null);
  };

  const deleteBlockFromEdit = (): void => {
    if (blockEdit === null) return;
    // Explicit delete is its own action; never coalesce with the create.
    inCreateEditFlowRef.current = false;
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
        pinned: false,
        energy: 'mid',
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
            pinned: p.pinned,
            energy: p.energy,
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
          return { id: p.id, name: p.name, color: p.color, pinned: p.pinned, energy: p.energy };
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

  const toggleProjectPinned = (id: string): void => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, pinned: !p.pinned } : p)));
  };

  const setProjectEnergy = (id: string, energy: ProjectEnergy): void => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, energy } : p)));
  };

  const updateProjectStartDate = (id: string, value: string): void => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const trimmed = value.trim();
        if (trimmed === '') {
          const { startDate: _drop, ...rest } = p;
          return rest;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return p;
        if (p.endDate !== undefined && trimmed > p.endDate) return p;
        return { ...p, startDate: trimmed };
      }),
    );
  };

  const updateProjectEndDate = (id: string, value: string): void => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const trimmed = value.trim();
        if (trimmed === '') {
          const { endDate: _drop, ...rest } = p;
          return rest;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return p;
        if (p.startDate !== undefined && trimmed < p.startDate) return p;
        return { ...p, endDate: trimmed };
      }),
    );
  };

  // Section classification is presence-based, NOT date-based. As soon as the
  // user drags a project to 終了済, endDate gets stamped and the project moves
  // sections — regardless of whether that date is in the current month.
  // The viewed-month filter (isProjectActiveInMonth) stays date-based for
  // sidebar / summary / proposal visibility.
  const todayYM = useMemo(() => yearMonthOf(today()), []);
  const todayDateStr = useMemo(() => today(), []);
  const isProjectOpen = (p: Project): boolean => p.endDate === undefined;


  const runProposalForDates = (targetDates: readonly DateString[]): void => {
    if (targetDates.length === 0) {
      setProposal({ drafts: [], rejected: new Set() });
      return;
    }
    // Split by year-month so each group uses its own budget context (spent +
    // remaining business days). Otherwise a Mon-Fri week spanning two months
    // would propose May 1 using April's budget.
    const byMonth = new Map<string, DateString[]>();
    for (const d of new Set(targetDates)) {
      const ym = yearMonthOf(d);
      const list = byMonth.get(ym) ?? [];
      list.push(d);
      byMonth.set(ym, list);
    }
    const todayD = today();
    const todayYm = yearMonthOf(todayD);
    const focusWindows = loadFocusWindows();
    const allDrafts: ProposedBlock[] = [];
    for (const [ym, monthDates] of byMonth) {
      if (ym < todayYm) continue; // skip past months — no proposing into yesterday
      const sortedMonthDates = [...monthDates].sort();
      // Anchor = today (current month) or month start (future month). This is
      // the denominator for "how many days the remaining budget spreads over".
      const anchor =
        ym === todayYm ? todayD : (sortedMonthDates[0] ?? `${ym}-01`);
      const monthAggregate = aggregateMonthly(mergedBlocksByDate, ym);
      const spentByProjectThisMonth: Record<string, number> = {};
      for (const [pid, mins] of monthAggregate.byProject) {
        spentByProjectThisMonth[pid] = mins / 60;
      }
      const existingBlocksByDate: Record<DateString, readonly TimeBlock[]> = {};
      for (const d of sortedMonthDates) {
        existingBlocksByDate[d] = mergedBlocksByDate[d] ?? [];
      }
      // Skip ended projects when proposing into a month after their endDate.
      const activePinnedForMonth = pinnedProjects.filter((p) => isProjectActiveInMonth(p, ym));
      if (activePinnedForMonth.length === 0) continue;
      const drafts = proposeAllocation({
        dates: sortedMonthDates,
        pinnedProjects: activePinnedForMonth,
        existingBlocksByDate,
        focusWindows,
        budgetContext: {
          spentByProjectThisMonth,
          monthRemainingBusinessDays: businessDaysRemainingInMonth(anchor),
          targetMonth: ym,
        },
      });
      allDrafts.push(...drafts);
    }
    setProposal({ drafts: allDrafts, rejected: new Set() });
  };

  const runProposal = (): void => {
    if (viewMode === 'week') {
      const weekDays = daysOfWeek(currentDate).slice(0, 5); // Mon-Fri
      runProposalForDates(weekDays);
    } else {
      runProposalForDates([currentDate]);
    }
  };
  const runProposalRef = useRef(runProposal);
  runProposalRef.current = runProposal;

  const toggleProposalReject = (key: string): void => {
    setProposal((prev) => {
      if (prev === null) return prev;
      const next = new Set(prev.rejected);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, rejected: next };
    });
  };

  const setDayProposalRejected = (date: DateString, rejectAll: boolean): void => {
    setProposal((prev) => {
      if (prev === null) return prev;
      const next = new Set(prev.rejected);
      for (const d of prev.drafts) {
        if (d.date !== date) continue;
        const k = draftKey(d);
        if (rejectAll) next.add(k);
        else next.delete(k);
      }
      return { ...prev, rejected: next };
    });
  };

  const acceptProposal = (): void => {
    if (proposal === null) return;
    const accepted = proposal.drafts.filter((d) => !proposal.rejected.has(draftKey(d)));
    if (accepted.length === 0) {
      setProposal(null);
      return;
    }
    // Group by date, pre-allocate IDs (pure under React StrictMode double-invoke).
    const candidatesByDate = new Map<DateString, TimeBlock[]>();
    for (const d of accepted) {
      const startMin = parseHHMM(d.start);
      const endMin = parseHHMM(d.end);
      if (startMin === null || endMin === null) continue;
      const block: TimeBlock = {
        id: crypto.randomUUID(),
        label: '作業',
        start: startMin,
        durationMin: endMin - startMin,
        projectId: d.projectId,
      };
      const list = candidatesByDate.get(d.date) ?? [];
      list.push(block);
      candidatesByDate.set(d.date, list);
    }
    // Capture GCal blocks per affected date at click time (sync window is 5 min).
    const gcalByDate = new Map<DateString, readonly TimeBlock[]>();
    for (const [date] of candidatesByDate) {
      gcalByDate.set(date, (mergedBlocksByDate[date] ?? []).filter((b) => b.source === 'gcal'));
    }
    setBlocksByDate((prev) => {
      // Re-validate against latest native state per day, inside the updater.
      const next: Record<DateString, readonly TimeBlock[]> = { ...prev };
      let anyPlaced = false;
      for (const [date, candidates] of candidatesByDate) {
        const native = (prev[date] ?? []).filter((b) => b.source !== 'gcal');
        const gcal = gcalByDate.get(date) ?? [];
        const day = new Day(date, [...native, ...gcal]);
        const placed: TimeBlock[] = [];
        for (const c of candidates) {
          const result = day.place(c);
          if (result.ok) placed.push(c);
        }
        if (placed.length > 0) {
          next[date] = [...native, ...placed];
          anyPlaced = true;
        }
      }
      return anyPlaced ? next : prev;
    });
    setProposal(null);
  };

  const closeSettings = (): void => {
    setShowSettings(false);
    setColorPickerProjectId(null);
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

  const activeProjects = useMemo(
    () => projects.filter(isProjectOpen),
    [projects, todayYM], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const closedProjects = useMemo(
    () => projects.filter((p) => !isProjectOpen(p)),
    [projects, todayYM], // eslint-disable-line react-hooks/exhaustive-deps
  );

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

  const renderProjectRowContent = (
    p: Project,
    section: 'active' | 'closed',
    handle?: ReactNode,
  ): ReactNode => {
    const pickerOpen = colorPickerProjectId === p.id;
    const isClosed = section === 'closed';
    return (
      <>
        <div className="flex items-center gap-2">
          {handle ?? (
            <span className="shrink-0 w-4 text-muted-foreground/30">
              <GripVertical className="size-4" />
            </span>
          )}
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
        <div className="flex items-center gap-3 mt-2 pl-7 flex-wrap">
          <button
            type="button"
            onClick={() => toggleProjectPinned(p.id)}
            title={p.pinned ? 'サイドバーから外す' : 'サイドバーに表示'}
            aria-label={p.pinned ? 'サイドバーから外す' : 'サイドバーに表示'}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors',
              p.pinned
                ? 'bg-primary/15 text-primary hover:bg-primary/20'
                : 'text-muted-foreground hover:bg-accent/40',
            )}
          >
            {p.pinned ? <Pin className="size-3" /> : <PinOff className="size-3" />}
            {p.pinned ? 'ピン留め中' : 'ピン留めしない'}
          </button>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">負荷</span>
            <Select
              value={p.energy}
              onValueChange={(v) => setProjectEnergy(p.id, v as ProjectEnergy)}
            >
              <SelectTrigger className="h-7 w-[68px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">軽</SelectItem>
                <SelectItem value="mid">中</SelectItem>
                <SelectItem value="high">重</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span className="text-[10px] tracking-wider uppercase text-muted-foreground/60 ml-auto">
            {isClosed ? '終了済' : '進行中'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 pl-7 flex-wrap">
          <span className="text-[11px] text-muted-foreground shrink-0">期間</span>
          <Input
            type="date"
            value={p.startDate ?? ''}
            onChange={(e) => updateProjectStartDate(p.id, e.currentTarget.value)}
            {...(p.endDate !== undefined ? { max: p.endDate } : {})}
            aria-label="開始日"
            className="h-7 w-[138px] text-xs tabular-nums"
          />
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => updateProjectStartDate(p.id, '')}
            disabled={p.startDate === undefined}
            title="開始日をクリア"
            aria-label="開始日をクリア"
            className="text-muted-foreground/60"
          >
            <X />
          </Button>
          <span className="text-[11px] text-muted-foreground/60">〜</span>
          <Input
            type="date"
            value={p.endDate ?? ''}
            onChange={(e) => updateProjectEndDate(p.id, e.currentTarget.value)}
            {...(p.startDate !== undefined ? { min: p.startDate } : {})}
            aria-label="終了日"
            className="h-7 w-[138px] text-xs tabular-nums"
          />
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => updateProjectEndDate(p.id, '')}
            disabled={p.endDate === undefined}
            title="終了日をクリア"
            aria-label="終了日をクリア"
            className="text-muted-foreground/60"
          >
            <X />
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
      </>
    );
  };

  // Sortable wrapper for one project row inside a section's SortableContext.
  // The handle (GripVertical) is the drag activator via {...listeners}; the
  // rest of the row stays interactive (inputs / selects / buttons remain
  // usable because the row itself is not draggable).
  //
  // No DragOverlay: the source row itself "lifts" via scale/rotate/shadow and
  // tracks the cursor via useSortable's transform. This is the Mac Finder /
  // iOS Reminders reorder paradigm and avoids the DragOverlay-vs-Radix-Dialog
  // (transformed ancestor) cursor-misalignment problem in WKWebView.
  const SortableProjectRow = ({ p, section }: { p: Project; section: 'active' | 'closed' }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging }
      = useSortable({ id: p.id });
    const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition: transition ?? undefined,
      position: 'relative', // ensure zIndex applies during drag (block elements ignore z-index without positioning)
      ...(isDragging
        ? {
            opacity: 0.92,
            zIndex: 50,
            boxShadow: 'var(--shadow-floaty)',
            scale: '1.02',
            rotate: '-0.4deg',
            background: 'var(--card)',
            borderRadius: '8px',
            cursor: 'grabbing',
          }
        : {}),
    };
    const handle = (
      <span
        {...listeners}
        {...attributes}
        title="ドラッグで並び替え (セクション間も可)"
        className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground shrink-0 select-none touch-none"
      >
        <GripVertical className="size-4" />
      </span>
    );
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'py-2 border-b border-border/60',
          section === 'closed' && 'opacity-70',
        )}
      >
        {renderProjectRowContent(p, section, handle)}
      </div>
    );
  };

  const SectionDroppable = ({
    section,
    children,
    placeholder,
  }: {
    section: 'active' | 'closed';
    children: ReactNode;
    placeholder?: string;
  }) => {
    const id = section === 'active' ? '__section_active__' : '__section_closed__';
    const { setNodeRef, isOver } = useDroppable({ id });
    const showPlaceholder = placeholder !== undefined;
    // Persistent trailing drop hint: a low-key 22px strip below the items so the
    // user always has a visible target for "drop at end of section", even when
    // items fill the section. Highlights when dragged over (closestCenter picks
    // the section wrapper here since no item is near the cursor).
    const showTrailingHint = !showPlaceholder && activeDragProjectId !== null;
    return (
      <div
        ref={setNodeRef}
        className={cn(
          'rounded transition-colors',
          isOver && activeDragProjectId !== null && 'bg-primary/8 outline-dashed outline-1 outline-primary/40',
          showPlaceholder && 'min-h-[40px] flex items-center justify-center text-[11px] text-muted-foreground/70 px-2 py-2.5',
        )}
      >
        {showPlaceholder ? placeholder : children}
        {showTrailingHint && (
          <div className="mt-1 h-[22px] rounded border border-dashed border-border/60 flex items-center justify-center text-[10px] text-muted-foreground/60 tracking-wide">
            {section === 'active' ? 'ここにドロップで進行中の末尾へ' : 'ここにドロップで終了済へ'}
          </div>
        )}
      </div>
    );
  };

  const projectsSensors = useSensors(
    // distance: 5 to avoid swallowing handle clicks; activation needs movement.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleProjectSortStart = (e: DragStartEvent): void => {
    const sourceId = String(e.active.id);
    setActiveDragProjectId(sourceId);
    // If user starts dragging an open project while the 終了済 section is
    // collapsed, temporarily expand it so the drop target is visible. We
    // remember the prior state and restore it on drag end UNLESS the drop
    // actually landed in 終了済 (in which case we keep it expanded so the
    // user can see the result).
    const sourceProj = projects.find((p) => p.id === sourceId);
    if (sourceProj !== undefined && isProjectOpen(sourceProj) && !closedSectionExpanded) {
      closedExpandedBeforeDragRef.current = false;
      setClosedSectionExpanded(true);
    }
  };

  const restoreClosedExpansion = (droppedInClosed: boolean): void => {
    if (closedExpandedBeforeDragRef.current === false && !droppedInClosed) {
      setClosedSectionExpanded(false);
    }
    closedExpandedBeforeDragRef.current = null;
  };

  const handleProjectSortCancel = (): void => {
    setActiveDragProjectId(null);
    restoreClosedExpansion(false);
  };

  const handleProjectSortEnd = (e: DragEndEvent): void => {
    setActiveDragProjectId(null);
    const { active, over } = e;
    if (over === null) {
      restoreClosedExpansion(false);
      return;
    }
    const sourceId = String(active.id);
    const overId = String(over.id);
    if (sourceId === overId) {
      restoreClosedExpansion(false);
      return;
    }

    const sourceIdx = projects.findIndex((p) => p.id === sourceId);
    if (sourceIdx === -1) {
      restoreClosedExpansion(false);
      return;
    }
    const sourceProj = projects[sourceIdx]!;
    const sourceWasOpen = isProjectOpen(sourceProj);

    let targetSection: 'active' | 'closed';
    let destIdx: number;
    if (overId === '__section_active__') {
      targetSection = 'active';
      const activeCount = activeProjects.length;
      // Position right after the existing tail of active. If source itself was
      // open, the tail count is one less; otherwise source is joining anew.
      destIdx = sourceWasOpen ? Math.max(0, activeCount - 1) : activeCount;
    } else if (overId === '__section_closed__') {
      targetSection = 'closed';
      destIdx = projects.length - 1;
    } else {
      const overIdx = projects.findIndex((p) => p.id === overId);
      if (overIdx === -1) {
        restoreClosedExpansion(false);
        return;
      }
      const overProj = projects[overIdx]!;
      targetSection = isProjectOpen(overProj) ? 'active' : 'closed';
      destIdx = overIdx;
    }

    setProjects((prev) => {
      const next = [...prev];
      // Cross-section: stamp / clear endDate on the source row before moving.
      if (sourceWasOpen && targetSection === 'closed') {
        next[sourceIdx] = { ...sourceProj, endDate: todayDateStr };
      } else if (!sourceWasOpen && targetSection === 'active') {
        const { endDate: _drop, ...rest } = sourceProj;
        next[sourceIdx] = rest;
      }
      return arrayMove(next, sourceIdx, destIdx);
    });
    restoreClosedExpansion(targetSection === 'closed');
  };

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
            稼働中案件
          </h2>
          {activeSidebarProjects.length === 0 && (
            <div className="text-[11px] text-muted-foreground/70 px-1.5 py-1 leading-relaxed">
              {pinnedProjects.length === 0
                ? '案件をピン留めすると、ここに表示されます。'
                : `${formatJaYearMonth(yearMonthOf(currentDate))} に進行中の案件はありません。`}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {activeSidebarProjects.map((p) => {
              const dragEnabled = viewMode === 'day';
              return (
                <div
                  key={p.id}
                  draggable={dragEnabled}
                  onDragStart={(e) => handleProjectDragStart(e, p.id)}
                  title={dragEnabled ? undefined : '日ビューで配置できます'}
                  className={cn(
                    'bg-card border rounded-md text-[13px] select-none',
                    'pl-2.5 pr-2.5 py-2 transition-shadow',
                    dragEnabled
                      ? 'cursor-grab hover:shadow-sm'
                      : 'cursor-default opacity-50',
                  )}
                  style={{
                    borderLeft: `4px solid ${p.color}`,
                    boxShadow: 'var(--shadow-soft)',
                  }}
                >
                  <div className="leading-tight font-medium">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    {p.monthlyBudget !== undefined ? (
                      <span>{p.monthlyBudget} 人月</span>
                    ) : (
                      <span className="text-muted-foreground/60">予算なし</span>
                    )}
                    <span className="text-muted-foreground/40">·</span>
                    <span>負荷 {ENERGY_LABEL[p.energy]}</span>
                  </div>
                </div>
              );
            })}
          </div>
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
          {(viewMode === 'day' || viewMode === 'week') && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={runProposal}
              title={`${viewMode === 'week' ? '今週 (月-金) の配分を提案' : 'この日の配分を提案'} (G)`}
              aria-label="配分提案"
            >
              <Sparkles />
            </Button>
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
            title={`設定 (${isMac ? '⌘' : 'Ctrl'} ,)`}
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
            projects={projects}
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

      <UpdateAvailableDialog updater={updater} />

      <Dialog open={showSettings} onOpenChange={(open) => { if (!open) closeSettings(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1 text-base">
              {settingsView !== 'menu' && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setSettingsView(settingsParent(settingsView))}
                  aria-label="戻る"
                  title="戻る"
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
                { key: 'projects' as const, label: '案件設定', desc: '案件の追加・編集・削除、月予算、ピン留め、負荷' },
                { key: 'gcal' as const, label: 'Google 連携', desc: 'Calendar の予定取り込みと、Drive 経由でのマルチデバイス同期' },
                { key: 'data' as const, label: 'データ移行', desc: 'ブラウザ localStorage から JSON で取り込み（上書き）' },
                { key: 'updates' as const, label: 'アップデート', desc: `現在 v${updater.appVersion ?? '—'}・新しいバージョンを確認` },
                { key: 'help' as const, label: '使い方', desc: '基本操作とショートカットの早見表' },
                { key: 'releases' as const, label: 'リリースノート', desc: 'バージョンごとの変更点' },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSettingsView(item.key)}
                  className="flex items-center justify-between gap-3 px-3.5 py-3 bg-card border border-border rounded-md cursor-pointer text-left text-foreground transition-colors hover:bg-accent/40 hover:border-border"
                >
                  <div>
                    <div className="text-[13px] font-semibold flex items-center gap-2">
                      <span>{item.label}</span>
                      {item.key === 'updates' && updater.hasUpdate && (
                        <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">
                          更新あり
                        </span>
                      )}
                    </div>
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
              <div className="mb-4 space-y-3">
                {projects.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">案件が登録されておりません</div>
                ) : (
                  <DndContext
                    sensors={projectsSensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleProjectSortStart}
                    onDragEnd={handleProjectSortEnd}
                    onDragCancel={handleProjectSortCancel}
                  >
                    <div>
                      <button
                        type="button"
                        onClick={() => setActiveSectionExpanded((v) => !v)}
                        className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground tracking-widest uppercase w-full hover:text-foreground transition-colors py-1"
                      >
                        <ChevronDown
                          className={cn('size-3.5 transition-transform', !activeSectionExpanded && '-rotate-90')}
                        />
                        <span>進行中 ({activeProjects.length})</span>
                      </button>
                      {activeSectionExpanded && (
                        <SectionDroppable
                          section="active"
                          {...(activeProjects.length === 0 ? { placeholder: '進行中の案件はありません。' } : {})}
                        >
                          <SortableContext
                            items={activeProjects.map((p) => p.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {activeProjects.map((p) => (
                              <SortableProjectRow key={p.id} p={p} section="active" />
                            ))}
                          </SortableContext>
                        </SectionDroppable>
                      )}
                    </div>

                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => setClosedSectionExpanded((v) => !v)}
                        className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground tracking-widest uppercase w-full hover:text-foreground transition-colors py-1"
                      >
                        <ChevronDown
                          className={cn('size-3.5 transition-transform', !closedSectionExpanded && '-rotate-90')}
                        />
                        <span>終了済 ({closedProjects.length})</span>
                      </button>
                      {closedSectionExpanded && (
                        <SectionDroppable
                          section="closed"
                          {...(closedProjects.length === 0 ? { placeholder: '終了済の案件はありません。' } : {})}
                        >
                          <SortableContext
                            items={closedProjects.map((p) => p.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {closedProjects.map((p) => (
                              <SortableProjectRow key={p.id} p={p} section="closed" />
                            ))}
                          </SortableContext>
                        </SectionDroppable>
                      )}
                      {!closedSectionExpanded && activeDragProjectId !== null && (
                        <SectionDroppable section="closed" placeholder="ここにドロップで終了済へ">{null}</SectionDroppable>
                      )}
                    </div>

                  </DndContext>
                )}
              </div>

              <div className="border-t border-border/60 pt-3.5">
                {addProjectFormOpen ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-foreground/85 font-semibold">新しい案件を追加</div>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setAddProjectFormOpen(false);
                          setNewProjectName('');
                          setNewProjectBudget('');
                        }}
                      >
                        キャンセル
                      </Button>
                    </div>
                    <Input
                      autoFocus
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          submitNewProject();
                          setAddProjectFormOpen(false);
                        }
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
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          submitNewProject();
                          setAddProjectFormOpen(false);
                        }
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
                      onClick={() => {
                        submitNewProject();
                        setAddProjectFormOpen(false);
                      }}
                      disabled={newProjectName.trim().length === 0}
                      className="w-full"
                    >
                      <Plus />
                      追加
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAddProjectFormOpen(true)}
                    className="w-full"
                  >
                    <Plus />
                    新しい案件を追加
                  </Button>
                )}
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
                                <div>しばらく待ってから再同期ボタンを押してください。</div>
                              </>
                            ) : gcalSync.errorStatus !== null && gcalSync.errorStatus >= 500 ? (
                              <>
                                <div className="font-semibold">Google 側のサーバエラー</div>
                                <div>少し時間を置いて再同期してください ({gcalSync.errorStatus})</div>
                              </>
                            ) : (
                              <>
                                <div className="font-semibold">同期エラー</div>
                                <div>{gcalSync.errorMessage ?? 'ネットワーク接続を確認してください'}</div>
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
                        const hiddenCount = Object.values(gcalAssignments).filter((a) => a.hidden === true).length;
                        const rulesCount = Object.keys(gcalSummaryRules).length;
                        return (
                          <div className="mt-3 pt-2.5 border-t border-border/60 grid grid-cols-2 gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSettingsView('gcal-hidden')}
                              disabled={hiddenCount === 0}
                              className="justify-between"
                            >
                              <span>非表示中のイベント</span>
                              <span className="text-muted-foreground tabular-nums">{hiddenCount}</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSettingsView('gcal-rules')}
                              disabled={rulesCount === 0}
                              className="justify-between"
                            >
                              <span>同名予定ルール</span>
                              <span className="text-muted-foreground tabular-nums">{rulesCount}</span>
                            </Button>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              )}

              <div className="border-t border-border pt-5">
                <div className="text-[13px] font-semibold mb-3">Drive 同期</div>
                <DriveSyncPanel sync={driveSync} />
              </div>
            </div>
          )}

          {settingsView === 'gcal-hidden' && (() => {
            const q = settingsSearch.trim().toLowerCase();
            const all = Object.entries(gcalAssignments).filter(([, a]) => a.hidden === true);
            const filtered = q.length === 0
              ? all
              : all.filter(([, a]) => (a.summary ?? '').toLowerCase().includes(q));
            return (
              <div className="space-y-3">
                <Input
                  value={settingsSearch}
                  onChange={(e) => setSettingsSearch(e.currentTarget.value)}
                  placeholder="タイトルで検索"
                  autoFocus
                />
                {all.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">非表示にしているイベントはありません。</div>
                ) : filtered.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">該当なし</div>
                ) : (
                  <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
                    {filtered.map(([key, a]) => (
                      <div key={key} className="flex items-center gap-2 px-2.5 py-1.5 bg-card border border-border/40 rounded text-xs">
                        <span className="flex-1 text-foreground/85 truncate" title={a.summary}>
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
                )}
                <div className="text-[11px] text-muted-foreground/80">
                  {filtered.length} / {all.length} 件
                </div>
              </div>
            );
          })()}

          {settingsView === 'gcal-rules' && (() => {
            const q = settingsSearch.trim().toLowerCase();
            const all = Object.entries(gcalSummaryRules);
            const filtered = q.length === 0
              ? all
              : all.filter(([summary, r]) => {
                  if (summary.toLowerCase().includes(q)) return true;
                  if (r.projectId !== undefined) {
                    const proj = projectById.get(r.projectId);
                    if (proj?.name.toLowerCase().includes(q)) return true;
                  }
                  return false;
                });
            return (
              <div className="space-y-3">
                <Input
                  value={settingsSearch}
                  onChange={(e) => setSettingsSearch(e.currentTarget.value)}
                  placeholder="タイトル / 案件名で検索"
                  autoFocus
                />
                {all.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">同名予定ルールはありません。</div>
                ) : filtered.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">該当なし</div>
                ) : (
                  <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
                    {filtered.map(([summary, r]) => {
                      const proj = r.projectId !== undefined ? projectById.get(r.projectId) : undefined;
                      return (
                        <div key={summary} className="flex items-center gap-2 px-2.5 py-1.5 bg-card border border-border/40 rounded text-xs">
                          <span className="flex-1 text-foreground/85 truncate" title={summary}>
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
                )}
                <div className="text-[11px] text-muted-foreground/80">
                  {filtered.length} / {all.length} 件
                </div>
              </div>
            );
          })()}

          {settingsView === 'data' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                ブラウザ (Chrome 等) で動かしていた taskette の localStorage を取り込みます。
                ブラウザの DevTools コンソールで以下を実行してクリップボードにコピーし、下のテキスト欄に貼り付けてください。
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
                取り込みは現在のデータをすべて上書きします。元には戻せません。
              </div>
              {importError !== null && (
                <div className="text-xs text-destructive">エラー: {importError}</div>
              )}
              {importStatus === 'success' && (
                <div className="text-xs text-emerald-600">取り込み完了しました。</div>
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
                  現在はブラウザ環境のため、取り込み先も localStorage です。Tauri アプリで実行すれば SQLite に書き込まれます。
                </div>
              )}
            </div>
          )}

          {settingsView === 'updates' && <UpdatesPanel updater={updater} />}

          {settingsView === 'help' && (
            <HelpPanel onOpenShortcuts={() => {
              closeSettings();
              setShowKeyboardHelp(true);
            }} />
          )}

          {settingsView === 'releases' && <ReleaseNotesPanel />}
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
                    {projects.filter((p) => isProjectActiveInMonth(p, ym)).map((p) => {
                      const minutes = aggregate.byProject.get(p.id) ?? 0;
                      const u = projectBudgetUsage(p, minutes, elapsed, ym, todayDateStr);
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
                    {projects
                      .filter((p) =>
                        isProjectActiveInMonth(p, yearMonthOf(currentDate))
                        || blockEdit.projectId === p.id
                      )
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-[3px] inline-block"
                              style={{ background: p.color }}
                            />
                            {p.name}
                            {p.endDate !== undefined
                              && yearMonthOf(currentDate) > p.endDate.slice(0, 7) && (
                                <span className="text-[10px] text-muted-foreground">(終了)</span>
                            )}
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

      <Dialog open={proposal !== null} onOpenChange={(open) => { if (!open) setProposal(null); }}>
        {proposal !== null && (() => {
          const draftsByDate = new Map<DateString, ProposedBlock[]>();
          for (const d of proposal.drafts) {
            const list = draftsByDate.get(d.date) ?? [];
            list.push(d);
            draftsByDate.set(d.date, list);
          }
          const orderedDates = [...draftsByDate.keys()].sort();
          const isMultiDay = orderedDates.length > 1;
          const headerLabel = isMultiDay
            ? `配分提案 — ${orderedDates.length}日分`
            : `配分提案 — ${formatJaDate(orderedDates[0] ?? currentDate)}`;
          return (
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{headerLabel}</DialogTitle>
              </DialogHeader>
              {proposal.drafts.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 leading-relaxed">
                  提案できる配分が見つかりませんでした。<br />
                  ピン留め案件の月予算・残営業日・既存ブロックを確認してください。
                  {isMultiDay && (
                    <><br /><span className="text-[11px]">※ 平日のみ対象 (土日除外)</span></>
                  )}
                </div>
              ) : (
                <>
                  {isMultiDay && (
                    <div className="text-[11px] text-muted-foreground/80 -mt-1">
                      平日のみ対象 (土日除外)。日付ヘッダーで一括選択/解除できます。
                    </div>
                  )}
                  <div className="flex flex-col gap-2 max-h-[460px] overflow-auto pr-1">
                    {orderedDates.map((date) => {
                      const dayDrafts = draftsByDate.get(date) ?? [];
                      const dayKeys = dayDrafts.map(draftKey);
                      const dayAcceptedCount = dayKeys.filter((k) => !proposal.rejected.has(k)).length;
                      const dayAllAccepted = dayAcceptedCount === dayDrafts.length;
                      return (
                        <div key={date} className="flex flex-col gap-1">
                          {isMultiDay && (
                            <div className="flex items-baseline justify-between px-1 pt-1 pb-0.5">
                              <span className="text-xs font-semibold text-foreground/80">
                                {formatJaDate(date)}
                              </span>
                              <button
                                type="button"
                                onClick={() => setDayProposalRejected(date, dayAllAccepted)}
                                className="text-[11px] text-primary hover:underline cursor-pointer"
                              >
                                {dayAllAccepted ? 'この日を全解除' : 'この日を全選択'}
                              </button>
                            </div>
                          )}
                          {dayDrafts.map((d) => {
                            const k = draftKey(d);
                            const accepted = !proposal.rejected.has(k);
                            const proj = projectById.get(d.projectId);
                            return (
                              <button
                                key={k}
                                type="button"
                                onClick={() => toggleProposalReject(k)}
                                className={cn(
                                  'flex items-start gap-3 px-3 py-2.5 border rounded-md text-left transition-colors cursor-pointer',
                                  accepted
                                    ? 'bg-card hover:bg-accent/30 border-border'
                                    : 'bg-muted/30 border-border/40 opacity-60',
                                )}
                              >
                                <Checkbox checked={accepted} className="mt-0.5 pointer-events-none" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-[13px] font-semibold flex items-center gap-1.5">
                                      <span
                                        className="inline-block w-2.5 h-2.5 rounded-full"
                                        style={{ background: proj?.color ?? '#A39A92' }}
                                      />
                                      {proj?.name ?? '未割当'}
                                    </span>
                                    <span className="text-xs text-muted-foreground tabular-nums">
                                      {d.start}–{d.end}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                                    {d.reason}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setProposal(null)}>
                  キャンセル
                </Button>
                {proposal.drafts.length > 0 && (
                  <Button
                    onClick={acceptProposal}
                    disabled={proposal.drafts.length === proposal.rejected.size}
                  >
                    採用 ({proposal.drafts.length - proposal.rejected.size}件)
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          );
        })()}
      </Dialog>
    </div>
  );
}
