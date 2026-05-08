import { useMemo, useState, type DragEvent } from 'react';
import { Day } from './domain/day.js';
import type { TaskTemplate, TimeBlock } from './domain/types.js';
import { SAMPLE_TEMPLATES } from './templates.js';

const PX_PER_MIN = 1;
const SNAP_MIN = 15;
const TODAY = '2026-05-09';

const pad2 = (n: number): string => n.toString().padStart(2, '0');

const formatMinute = (m: number): string => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

export function App() {
  const [blocks, setBlocks] = useState<readonly TimeBlock[]>([]);
  const [error, setError] = useState<string | null>(null);

  const templateById = useMemo(() => {
    const m = new Map<string, TaskTemplate>();
    for (const t of SAMPLE_TEMPLATES) m.set(t.id, t);
    return m;
  }, []);

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const templateId = e.dataTransfer.getData('templateId');
    const tmpl = templateById.get(templateId);
    if (!tmpl) return;

    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const y = e.clientY - rect.top + target.scrollTop;
    const rawMinute = Math.max(0, Math.round(y / PX_PER_MIN));
    const snapped = Math.round(rawMinute / SNAP_MIN) * SNAP_MIN;

    const day = new Day(TODAY, blocks);
    const newBlock: TimeBlock = {
      id: crypto.randomUUID(),
      label: tmpl.label,
      start: snapped,
      durationMin: tmpl.defaultDurationMin,
      templateId: tmpl.id,
    };
    const result = day.place(newBlock);
    if (result.ok) {
      setBlocks(day.blocks);
      setError(null);
    } else if (result.reason === 'overlap') {
      setError(`重なっていますわ — ${formatMinute(snapped)} は他のブロックと衝突しています`);
    } else {
      setError(result.message);
    }
  };

  const handleRemove = (id: string): void => {
    const day = new Day(TODAY, blocks);
    day.remove(id);
    setBlocks(day.blocks);
    setError(null);
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, templateId: string): void => {
    e.dataTransfer.setData('templateId', templateId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1f2937' }}>
      <aside style={{ background: '#f3f4f6', padding: '16px', borderRight: '1px solid #e5e7eb', overflow: 'auto' }}>
        <h2 style={{ fontSize: '13px', margin: '0 0 12px', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          テンプレート
        </h2>
        {SAMPLE_TEMPLATES.map((t) => (
          <div
            key={t.id}
            draggable
            onDragStart={(e) => handleDragStart(e, t.id)}
            style={{
              background: 'white',
              border: '1px solid #e5e7eb',
              borderLeft: `6px solid ${t.color ?? '#94a3b8'}`,
              padding: '8px 10px',
              marginBottom: '6px',
              borderRadius: '6px',
              cursor: 'grab',
              fontSize: '13px',
              userSelect: 'none',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}
          >
            <div>{t.label}</div>
            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{t.defaultDurationMin}分</div>
          </div>
        ))}
        <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '20px', lineHeight: 1.5 }}>
          右のタイムラインへドラッグ&amp;ドロップして配置してくださいませ。
        </p>
      </aside>

      <main style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white' }}>
          <h1 style={{ fontSize: '15px', margin: 0, fontWeight: 600 }}>taskette — {TODAY}</h1>
          {error !== null && <span style={{ color: '#dc2626', fontSize: '12px' }}>{error}</span>}
        </header>

        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          style={{ flex: 1, overflow: 'auto', position: 'relative', background: '#fafafa' }}
        >
          <div style={{ position: 'relative', height: `${1440 * PX_PER_MIN}px`, marginLeft: '52px' }}>
            {Array.from({ length: 25 }).map((_, h) => (
              <div key={h} style={{
                position: 'absolute',
                top: `${h * 60 * PX_PER_MIN}px`,
                left: '-52px',
                right: 0,
                borderTop: '1px solid #e5e7eb',
                pointerEvents: 'none',
              }}>
                <span style={{ position: 'absolute', top: '-8px', left: '8px', fontSize: '11px', color: '#9ca3af', background: '#fafafa', padding: '0 2px' }}>
                  {pad2(h)}:00
                </span>
              </div>
            ))}

            {blocks.map((b) => {
              const tmpl = b.templateId !== undefined ? templateById.get(b.templateId) : undefined;
              const color = tmpl?.color ?? '#64748b';
              return (
                <div
                  key={b.id}
                  style={{
                    position: 'absolute',
                    top: `${b.start * PX_PER_MIN}px`,
                    left: '6px',
                    right: '14px',
                    height: `${b.durationMin * PX_PER_MIN}px`,
                    background: color,
                    color: 'white',
                    borderRadius: '5px',
                    padding: '4px 8px',
                    fontSize: '12px',
                    overflow: 'hidden',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '4px' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.label}</span>
                    <button
                      onClick={() => handleRemove(b.id)}
                      style={{ background: 'rgba(0,0,0,0.25)', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px', padding: '0 6px', lineHeight: 1.4 }}
                      aria-label="削除"
                    >×</button>
                  </div>
                  {b.durationMin >= 25 && (
                    <div style={{ fontSize: '10px', opacity: 0.85, marginTop: '2px' }}>
                      {formatMinute(b.start)} – {formatMinute(b.start + b.durationMin)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
