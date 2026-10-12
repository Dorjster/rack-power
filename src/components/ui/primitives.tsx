import { useId, useState, type ReactNode } from 'react';
import type { CheckStatus } from '../../domain/types';
import { useT } from '../../i18n';

export const STATUS_STYLE: Record<CheckStatus | 'info', { icon: string; cls: string }> = {
  pass: { icon: '✓', cls: 'bg-emerald-950 text-emerald-300 border-emerald-700' },
  warning: { icon: '!', cls: 'bg-amber-950 text-amber-300 border-amber-700' },
  fail: { icon: '✕', cls: 'bg-red-950 text-red-300 border-red-700' },
  unknown: { icon: '?', cls: 'bg-violet-950 text-violet-300 border-violet-700' },
  na: { icon: '–', cls: 'bg-slate-800 text-slate-400 border-slate-600' },
  info: { icon: 'i', cls: 'bg-sky-950 text-sky-300 border-sky-700' },
};

export function StatusBadge({ status, label, small }: { status: CheckStatus | 'info'; label?: string; small?: boolean }) {
  const { t } = useT();
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded border font-medium whitespace-nowrap ${s.cls} ${small ? 'px-1 text-[10px]' : 'px-1.5 py-0.5 text-xs'}`}>
      <span aria-hidden className="font-bold">
        {s.icon}
      </span>
      {label ?? t(`status.${status}`)}
    </span>
  );
}

export function Help({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button type="button" className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-400 hover:text-cyan-300" aria-label={text}>
        ?
      </button>
      <span role="tooltip" className="pointer-events-none absolute left-5 top-0 z-50 hidden w-64 rounded-md border border-slate-600 bg-slate-900 p-2 text-xs font-normal text-slate-200 shadow-xl group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

export function Field({ label, help, children, unit, example, className = '' }: { label: string; help?: string; unit?: string; example?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-xs ${className}`}>
      <span className="flex items-center gap-1 font-medium text-slate-300">
        {label}
        {unit && <span className="text-slate-500">({unit})</span>}
        {help && <Help text={help} />}
      </span>
      {children}
      {example && <span className="text-[10px] text-slate-500">{example}</span>}
    </label>
  );
}

/**
 * Numeric input that preserves "unknown" (null). Rejects NaN/∞ and values outside [min,max].
 * The "Мэдэхгүй / Unknown" checkbox explicitly stores null — never a fictitious zero.
 */
export function NumInput({
  value,
  onChange,
  min,
  max,
  step = 'any',
  allowUnknown = true,
  allowZero = true,
  placeholder,
  ariaLabel,
  width = 'w-24',
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  allowUnknown?: boolean;
  allowZero?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  width?: string;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const unknown = value === null;
  const commit = (s: string) => {
    if (s.trim() === '') {
      if (allowUnknown) {
        onChange(null);
        setErr(null);
      } else setErr(t('val.required'));
      setDraft(null);
      return;
    }
    const n = Number(s.replace(',', '.'));
    if (!Number.isFinite(n)) return setErr(t('val.number'));
    if (!allowZero && n === 0) return setErr(t('val.positive'));
    if (min !== undefined && n < min) return setErr(t('val.min', { min }));
    if (max !== undefined && n > max) return setErr(t('val.max', { max }));
    setErr(null);
    setDraft(null);
    onChange(n);
  };
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          aria-label={ariaLabel}
          aria-invalid={!!err}
          className={`${width} ${err ? 'border-red-500!' : ''}`}
          value={draft ?? (value === null ? '' : String(value))}
          placeholder={unknown ? t('common.unknown') : placeholder}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
        />
        {allowUnknown && (
          <label className="inline-flex items-center gap-1 text-[10px] text-slate-400" title={t('common.unknownHelp')}>
            <input type="checkbox" checked={unknown} onChange={(e) => (e.target.checked ? onChange(null) : setDraft(''))} />
            {t('common.unknown')}
          </label>
        )}
      </span>
      {err && <span className="text-[10px] text-red-400">{err}</span>}
    </span>
  );
}

export function TextInput({ value, onChange, placeholder, className = '', ariaLabel }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; ariaLabel?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      aria-label={ariaLabel}
      className={className}
      value={draft ?? value}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onChange(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function Select<T extends string>({ value, onChange, options, ariaLabel, className = '' }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; ariaLabel?: string; className?: string }) {
  return (
    <select aria-label={ariaLabel} className={className} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Section({ title, children, defaultOpen = true, right, badge }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode; badge?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="card mb-3">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button type="button" className="flex min-w-0 items-center gap-2 text-left text-sm font-semibold text-slate-100" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <span className={`text-cyan-400 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
            ▶
          </span>
          <span className="truncate">{title}</span>
          {badge}
        </button>
        {right}
      </div>
      {open && (
        <div id={id} className="border-t border-slate-800 px-3 py-3">
          {children}
        </div>
      )}
    </section>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className = '' }: { tabs: { id: T; label: string; badge?: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={`scroll-thin flex gap-1 overflow-x-auto ${className}`}>
      {tabs.map((tb) => (
        <button
          key={tb.id}
          role="tab"
          type="button"
          aria-selected={value === tb.id}
          onClick={() => onChange(tb.id)}
          className={`flex shrink-0 items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium ${value === tb.id ? 'bg-cyan-900/60 text-cyan-200 ring-1 ring-cyan-700' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
        >
          {tb.label}
          {tb.badge}
        </button>
      ))}
    </div>
  );
}

export function ProvBadge({ status }: { status: string }) {
  const { t } = useT();
  const cls: Record<string, string> = {
    verified: 'border-emerald-700 text-emerald-300',
    measured: 'border-emerald-700 text-emerald-300',
    user_supplied: 'border-sky-700 text-sky-300',
    unverified: 'border-amber-700 text-amber-300',
    assumption: 'border-violet-700 text-violet-300',
    demo: 'border-pink-700 text-pink-300',
  };
  return <span className={`rounded border px-1 text-[10px] ${cls[status] ?? 'border-slate-600 text-slate-400'}`}>{t(`prov.${status}`)}</span>;
}

export function NeedInfo() {
  const { t } = useT();
  return <span className="rounded bg-amber-950 px-1 text-[10px] text-amber-300">{t('common.needInfo')}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-slate-700 p-4 text-center text-sm text-slate-400">{children}</div>;
}
