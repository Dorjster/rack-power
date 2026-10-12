import { useEffect, useRef } from 'react';
import { useStore, type RightTab } from './state/store';
import { useT } from './i18n';
import { Header } from './components/Header';
import { SummaryCards } from './components/SummaryCards';
import { RackPane } from './components/rack/RackPane';
import { Tabs } from './components/ui/primitives';
import { SetupWizard } from './components/panels/SetupWizard';
import { LibraryPanel } from './components/panels/LibraryPanel';
import { DevicePanel } from './components/panels/DevicePanel';
import { PowerPanel } from './components/panels/PowerPanel';
import { FeedsPanel } from './components/panels/FeedsPanel';
import { AuditPanel } from './components/panels/AuditPanel';
import { PolicyPanel } from './components/panels/PolicyPanel';
import { Report } from './components/report/Report';
import { loadLastProject, saveProject } from './persistence/db';
import { nowIso } from './domain/factory';
import { useAnalysis } from './state/useAnalysis';

export default function App() {
  const { t, lang } = useT();
  const showReport = useStore((s) => s.showReport);
  const mobileTab = useStore((s) => s.mobileTab);
  const splitPct = useStore((s) => s.splitPct);
  const setUi = useStore((s) => s.setUi);

  usePersistence();
  useShortcuts();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <>
      <div className={`flex h-full flex-col ${showReport ? 'no-print' : ''}`}>
        <Header />
        <div className="no-print border-b border-slate-800 px-3 py-2">
          <SummaryCards />
        </div>
        {/* Mobile tab switch */}
        <div className="flex gap-1 border-b border-slate-800 px-3 py-1.5 lg:hidden" role="tablist">
          {(['rack', 'settings'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mobileTab === m} className={`flex-1 rounded-md py-1.5 text-sm font-medium ${mobileTab === m ? 'bg-cyan-900/60 text-cyan-100' : 'text-slate-400'}`} onClick={() => setUi({ mobileTab: m })}>
              {t(`mobile.${m}`)}
            </button>
          ))}
        </div>
        <main className="flex min-h-0 flex-1">
          <section className={`scroll-thin min-h-0 min-w-0 flex-1 overflow-y-auto p-3 ${mobileTab === 'rack' ? 'block' : 'hidden'} lg:block lg:flex-none lg:[flex-basis:var(--split)]`} style={{ '--split': `${splitPct}%` } as React.CSSProperties} aria-label={t('mobile.rack')}>
            <RackPane />
          </section>
          <Splitter />
          <section className={`scroll-thin min-h-0 min-w-0 flex-1 overflow-y-auto ${mobileTab === 'settings' ? 'block' : 'hidden'} lg:block`} aria-label={t('mobile.settings')}>
            <RightPane />
          </section>
        </main>
      </div>
      {showReport && <Report />}
      <Toasts />
    </>
  );
}

function RightPane() {
  const { t } = useT();
  const tab = useStore((s) => s.rightTab);
  const setUi = useStore((s) => s.setUi);
  const selected = useStore((s) => s.selectedDeviceId);
  const rackId = useStore((s) => s.selectedRackId);
  const a = useAnalysis();
  const fails = a.byRack[rackId]?.findings.filter((f) => f.status === 'fail').length ?? 0;
  const advanced = useStore((s) => s.advanced);
  const all: { id: RightTab; label: string; badge?: React.ReactNode; advanced?: boolean }[] = [
    { id: 'setup', label: t('tab.setup') },
    { id: 'library', label: t('tab.library') },
    { id: 'device', label: t('tab.device'), badge: selected ? <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" /> : undefined },
    { id: 'feeds', label: t('tab.feeds'), advanced: true },
    { id: 'power', label: t('tab.power'), advanced: true },
    { id: 'audit', label: t('tab.audit'), badge: fails ? <span className="rounded bg-red-900 px-1 text-[10px] text-red-200">{fails}</span> : undefined },
    { id: 'policy', label: t('tab.policy'), advanced: true },
  ];
  // Basic mode shows only the four everyday tabs; engineering detail lives in Advanced.
  const tabs = all.filter((x) => advanced || !x.advanced);
  useEffect(() => {
    if (!tabs.some((x) => x.id === tab)) setUi({ rightTab: 'audit' });
  }, [advanced, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <div className="sticky top-0 z-20 border-b border-slate-800 bg-[#0b1220]/95 px-3 py-2 backdrop-blur">
        <Tabs tabs={tabs} value={tab} onChange={(v) => setUi({ rightTab: v })} />
      </div>
      <div className="p-3" role="tabpanel">
        {tab === 'setup' && <SetupWizard />}
        {tab === 'library' && <LibraryPanel />}
        {tab === 'device' && <DevicePanel />}
        {tab === 'feeds' && <FeedsPanel />}
        {tab === 'power' && <PowerPanel />}
        {tab === 'audit' && <AuditPanel />}
        {tab === 'policy' && <PolicyPanel />}
      </div>
    </div>
  );
}

function Splitter() {
  const setUi = useStore((s) => s.setUi);
  const { t } = useT();
  const dragging = useRef(false);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('layout.resize')}
      tabIndex={0}
      className="hidden w-1.5 shrink-0 cursor-col-resize bg-slate-800 hover:bg-cyan-700 lg:block"
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as Element).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const pct = (e.clientX / window.innerWidth) * 100;
        setUi({ splitPct: Math.min(70, Math.max(30, pct)) });
      }}
      onPointerUp={() => (dragging.current = false)}
      onKeyDown={(e) => {
        const cur = useStore.getState().splitPct;
        if (e.key === 'ArrowLeft') setUi({ splitPct: Math.max(30, cur - 2) });
        if (e.key === 'ArrowRight') setUi({ splitPct: Math.min(70, cur + 2) });
      }}
    />
  );
}

function Toasts() {
  const { t } = useT();
  const toasts = useStore((s) => s.toasts);
  const { dismissToast, undo } = useStore.getState();
  return (
    <div className="no-print pointer-events-none fixed right-3 bottom-3 z-[60] flex max-w-sm flex-col gap-2" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-xl ${x.kind === 'error' ? 'border-red-700 bg-red-950 text-red-100' : x.kind === 'success' ? 'border-emerald-700 bg-emerald-950 text-emerald-100' : 'border-slate-600 bg-slate-900 text-slate-100'}`}>
          <span className="flex-1">{x.text}</span>
          {x.undo && (
            <button
              className="btn btn-sm"
              onClick={() => {
                undo();
                dismissToast(x.id);
              }}
            >
              ↶ {t('header.undo')}
            </button>
          )}
          <button className="text-xs opacity-70" aria-label={t('common.close')} onClick={() => dismissToast(x.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/** Restore the last project from IndexedDB and autosave changes (debounced). */
function usePersistence() {
  const project = useStore((s) => s.project);
  const loaded = useRef(false);
  useEffect(() => {
    loadLastProject()
      .then((p) => {
        if (p) useStore.getState().loadProject(p);
      })
      .catch(() => {})
      .finally(() => {
        loaded.current = true;
      });
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    if (useStore.getState().saveStatus === 'saved') return;
    const h = setTimeout(async () => {
      useStore.getState().setUi({ saveStatus: 'saving' });
      try {
        await saveProject(useStore.getState().project);
        useStore.getState().setUi({ saveStatus: 'saved', lastSavedAt: nowIso() });
      } catch {
        useStore.getState().setUi({ saveStatus: 'error' });
      }
    }, 800);
    return () => clearTimeout(h);
  }, [project]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        useStore.getState().undo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        useStore.getState().redo();
      } else if (e.key === 'Escape') useStore.getState().setUi({ showReport: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
