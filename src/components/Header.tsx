import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useAnalysis } from '../state/useAnalysis';
import { useT } from '../i18n';
import { scenarioLabel } from '../audit/rules';
import { TextInput } from './ui/primitives';
import { download, equipmentCsv, exportBundle, exportJson, findingsCsv, base64ToBlob } from '../persistence/io';
import { parseImport } from '../persistence/validate';
import { deleteProject, listProjects, loadProject, saveBlob, saveProject, type ProjectIndexEntry } from '../persistence/db';
import { buildDemoProject } from '../domain/demo';
import { newProject, nowIso } from '../domain/factory';

export function Header() {
  const { t, tm, lang } = useT();
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const scenarioId = useStore((s) => s.scenarioId);
  const saveStatus = useStore((s) => s.saveStatus);
  const lastSavedAt = useStore((s) => s.lastSavedAt);
  const advanced = useStore((s) => s.advanced);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const { setUi, update, undo, redo, toast, loadProject: load } = useStore.getState();
  const a = useAnalysis();
  const rack = project.racks.find((r) => r.id === rackId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const [saved, setSaved] = useState<ProjectIndexEntry[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    listProjects().then(setSaved);
    const close = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const saveNow = async () => {
    setUi({ saveStatus: 'saving' });
    try {
      await saveProject(useStore.getState().project);
      setUi({ saveStatus: 'saved', lastSavedAt: nowIso() });
    } catch {
      setUi({ saveStatus: 'error' });
      toast(t('save.error'), 'error');
    }
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${project.name.replace(/[^\p{L}\p{N}_-]+/gu, '_')}-${stamp}`;
  const doImport = async (file: File) => {
    setMenu(false);
    if (file.size > 60 * 1024 * 1024) return toast(t('io.tooBig'), 'error');
    const res = parseImport(await file.text());
    if (!res.ok || !res.project) return toast(`${t('io.importFail')}: ${res.errors.slice(0, 3).join('; ')}`, 'error');
    if (res.blobs) for (const [k, v] of Object.entries(res.blobs)) await saveBlob(k, base64ToBlob(v.data, v.mime));
    await saveProject(res.project);
    load(res.project);
    toast(t('io.imported', { warnings: res.warnings.length }) + (res.warnings.length ? ` (${res.warnings.slice(0, 2).join('; ')})` : ''), 'success');
  };

  const scenarioOptions = a.scenarios.map((s) => ({ value: s.def.id, label: tm(scenarioLabel(s.def, project)) }));

  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-800 bg-[#0b1220]/95 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-hidden>
            <rect x="6" y="2" width="20" height="28" rx="2" fill="#0f172a" stroke="#22d3ee" strokeWidth="2" />
            <rect x="9" y="6" width="14" height="3" fill="#22d3ee" />
            <rect x="9" y="11" width="14" height="3" fill="#38bdf8" />
            <path d="M17 17l-4 6h3l-1 4 4-6h-3z" fill="#facc15" />
          </svg>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold tracking-wider text-cyan-400 uppercase">Rack Power Planner & Audit</div>
            <div className="flex items-center gap-1 text-sm">
              <TextInput value={project.name} onChange={(v) => update((d) => (d.name = v || d.name))} className="w-40 border-transparent! bg-transparent! px-0! font-semibold sm:w-52" ariaLabel={t('header.project')} />
            </div>
          </div>
        </div>
        <div className="hidden min-w-0 flex-col text-[11px] text-slate-400 lg:flex">
          <span className="flex items-center gap-1">
            {t('header.customer')}: <TextInput value={project.customer} onChange={(v) => update((d) => (d.customer = v))} className="w-28 border-transparent! bg-transparent! px-0! py-0! text-[11px]" ariaLabel={t('header.customer')} />
          </span>
          <span className="flex items-center gap-1">
            {t('header.site')}: <TextInput value={project.site} onChange={(v) => update((d) => (d.site = v))} className="w-28 border-transparent! bg-transparent! px-0! py-0! text-[11px]" ariaLabel={t('header.site')} /> · {rack?.name}
          </span>
        </div>

        <div role="group" aria-label={t('header.mode')} className="inline-flex overflow-hidden rounded-md border border-slate-700 text-xs">
          {(['planning', 'audit'] as const).map((m) => (
            <button key={m} aria-pressed={project.mode === m} className={`px-2.5 py-1 ${project.mode === m ? 'bg-cyan-800 text-white' : 'bg-slate-900 text-slate-300'}`} onClick={() => update((d) => (d.mode = m))}>
              {t(`mode2.${m}`)}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1 text-xs text-slate-400">
          <span className="hidden sm:inline">{t('common.scenario')}:</span>
          <select aria-label={t('common.scenario')} value={scenarioOptions.some((o) => o.value === scenarioId) ? scenarioId : 'normal'} onChange={(e) => setUi({ scenarioId: e.target.value })} className="max-w-48 text-xs">
            {scenarioOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button className="btn btn-sm" onClick={undo} disabled={!past} title={`${t('header.undo')} (Ctrl+Z)`} aria-label={t('header.undo')}>
            ↶
          </button>
          <button className="btn btn-sm" onClick={redo} disabled={!future} title={`${t('header.redo')} (Ctrl+Y)`} aria-label={t('header.redo')}>
            ↷
          </button>
          <button className="btn btn-sm" onClick={saveNow} title={lastSavedAt ? `${t('save.last')}: ${new Date(lastSavedAt).toLocaleTimeString()}` : ''}>
            💾 {t('header.save')}
          </button>
          <span className={`text-[11px] ${saveStatus === 'saved' ? 'text-emerald-400' : saveStatus === 'error' ? 'text-red-400' : 'text-amber-300'}`} role="status" aria-live="polite">
            {t(`save.${saveStatus}`)}
          </span>
          <label className="inline-flex items-center gap-1 text-[11px] text-slate-300" title={t('help.advanced')}>
            <input type="checkbox" checked={advanced} onChange={(e) => setUi({ advanced: e.target.checked })} />
            {t('header.advanced')}
          </label>
          <div className="relative" ref={menuRef}>
            <button className="btn btn-sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              ⇅ {t('header.io')}
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 z-50 mt-1 w-72 rounded-md border border-slate-700 bg-slate-900 p-1 text-sm shadow-xl">
                <MenuItem onClick={() => (download(`${base}.json`, exportJson(project), 'application/json'), setMenu(false))}>⬇ {t('io.exportJson')}</MenuItem>
                <MenuItem onClick={async () => (download(`${base}-bundle.json`, await exportBundle(project), 'application/json'), setMenu(false))}>⬇ {t('io.exportBundle')}</MenuItem>
                <MenuItem onClick={() => (download(`${base}-equipment.csv`, equipmentCsv(project, a.scenarios[0], t), 'text/csv;charset=utf-8'), setMenu(false))}>⬇ {t('io.csvEquipment')}</MenuItem>
                <MenuItem onClick={() => (download(`${base}-findings.csv`, findingsCsv(a.byRack[rackId]?.findings ?? [], t, tm), 'text/csv;charset=utf-8'), setMenu(false))}>⬇ {t('io.csvFindings')}</MenuItem>
                <MenuItem onClick={() => fileRef.current?.click()}>⬆ {t('io.import')}</MenuItem>
                <p className="px-2 py-1 text-[10px] text-slate-500">{t('io.attachNote')}</p>
                <hr className="my-1 border-slate-700" />
                <MenuItem
                  onClick={async () => {
                    await saveProject(project);
                    const p = newProject({ name: t('io.newName') });
                    load(p);
                    setUi({ wizardStep: 0, rightTab: 'setup' });
                    setMenu(false);
                  }}
                >
                  ＋ {t('io.new')}
                </MenuItem>
                <MenuItem
                  onClick={async () => {
                    await saveProject(project);
                    load(buildDemoProject());
                    setMenu(false);
                  }}
                >
                  ★ {t('io.demo')}
                </MenuItem>
                {saved.length > 0 && <div className="px-2 pt-2 text-[10px] text-slate-500 uppercase">{t('io.saved')}</div>}
                {saved.map((s) => (
                  <div key={s.id} className="flex items-center">
                    <MenuItem
                      onClick={async () => {
                        await saveProject(project);
                        const p = await loadProject(s.id);
                        if (p) load(p);
                        else toast(t('io.loadFail'), 'error');
                        setMenu(false);
                      }}
                    >
                      {s.id === project.id ? '● ' : ''}
                      {s.name} <span className="text-[10px] text-slate-500">{s.updatedAt.slice(0, 10)}</span>
                    </MenuItem>
                    {s.id !== project.id && (
                      <button className="btn btn-ghost btn-sm" aria-label={t('common.delete')} onClick={async () => confirm(t('io.deleteConfirm', { name: s.name })) && (await deleteProject(s.id), setSaved(await listProjects()))}>
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => (e.target.files?.[0] && doImport(e.target.files[0]), (e.target.value = ''))} />
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => setUi({ showReport: true })}>
            🖨 {t('header.report')}
          </button>
          <button className="btn btn-sm" onClick={() => setUi({ lang: lang === 'mn' ? 'en' : 'mn' })} aria-label={t('header.lang')}>
            {lang === 'mn' ? 'EN' : 'МН'}
          </button>
        </div>
      </div>
      {project.isDemo && <div className="bg-pink-950/50 px-3 py-0.5 text-center text-[11px] text-pink-200">{t('header.demoBanner')}</div>}
    </header>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button role="menuitem" className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-xs hover:bg-slate-800" onClick={onClick}>
      {children}
    </button>
  );
}
