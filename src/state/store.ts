import { create } from 'zustand';
import { produce, setAutoFreeze } from 'immer';
import type { ID, Lang, Project } from '../domain/types';
import { buildDemoProject } from '../domain/demo';
import { nowIso } from '../domain/factory';

setAutoFreeze(false);

export type RightTab = 'setup' | 'library' | 'device' | 'power' | 'feeds' | 'audit' | 'policy';
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

const HISTORY_LIMIT = 100;

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
  undo?: boolean;
}

export interface AppState {
  project: Project;
  past: Project[];
  future: Project[];
  lang: Lang;
  selectedRackId: ID;
  selectedDeviceId: ID | null;
  rackView: 'front' | 'rear';
  showWiring: boolean;
  scenarioId: string;
  psuLossId: ID | null;
  rightTab: RightTab;
  mobileTab: 'rack' | 'settings';
  saveStatus: SaveStatus;
  lastSavedAt: string | null;
  advanced: boolean;
  showReport: boolean;
  wizardStep: number;
  splitPct: number;
  toasts: Toast[];
  /** Apply an undoable change to the project. */
  update: (fn: (draft: Project) => void) => void;
  undo: () => void;
  redo: () => void;
  setUi: (p: Partial<Omit<AppState, 'project' | 'past' | 'future'>>) => void;
  loadProject: (p: Project) => void;
  toast: (text: string, kind?: Toast['kind'], undo?: boolean) => void;
  dismissToast: (id: number) => void;
}

const demo = buildDemoProject();
let toastId = 0;

export const useStore = create<AppState>((set, get) => ({
  project: demo,
  past: [],
  future: [],
  lang: 'mn',
  selectedRackId: demo.racks[0].id,
  selectedDeviceId: null,
  rackView: 'front',
  showWiring: true,
  scenarioId: 'normal',
  psuLossId: null,
  rightTab: 'setup',
  mobileTab: 'rack',
  saveStatus: 'dirty',
  lastSavedAt: null,
  advanced: false,
  showReport: false,
  wizardStep: 0,
  splitPct: 45,
  toasts: [],

  update: (fn) => {
    const prev = get().project;
    const next = produce(prev, (d) => {
      fn(d);
      d.updatedAt = nowIso();
    });
    if (next === prev) return;
    set((s) => ({ project: next, past: [...s.past, prev].slice(-HISTORY_LIMIT), future: [], saveStatus: 'dirty' }));
  },
  undo: () => {
    const { past, project, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future], saveStatus: 'dirty' });
    fixSelection(get, set);
  },
  redo: () => {
    const { past, project, future } = get();
    if (!future.length) return;
    const next = future[0];
    set({ project: next, past: [...past, project], future: future.slice(1), saveStatus: 'dirty' });
    fixSelection(get, set);
  },
  setUi: (p) => set(p),
  loadProject: (p) =>
    set({
      project: p,
      past: [],
      future: [],
      selectedRackId: p.racks[0]?.id ?? '',
      selectedDeviceId: null,
      scenarioId: 'normal',
      psuLossId: null,
      saveStatus: 'saved',
    }),
  toast: (text, kind = 'info', undo = false) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind, undo }] }));
    setTimeout(() => get().dismissToast(id), undo ? 8000 : 4500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

function fixSelection(get: () => AppState, set: (p: Partial<AppState>) => void) {
  const { project, selectedRackId, selectedDeviceId } = get();
  const patch: Partial<AppState> = {};
  if (!project.racks.some((r) => r.id === selectedRackId)) patch.selectedRackId = project.racks[0]?.id ?? '';
  if (selectedDeviceId && !project.devices.some((d) => d.id === selectedDeviceId)) patch.selectedDeviceId = null;
  if (Object.keys(patch).length) set(patch);
}
