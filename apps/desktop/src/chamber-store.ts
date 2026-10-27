import { create } from 'zustand';
import type { Snapshot } from '../../../packages/contracts/index.ts';
export type Panel = 'activity' | 'system' | 'settings' | 'projects' | 'work' | 'inbox' | 'jobs' | 'memory' | 'media' | null;
interface ChamberState {
  snapshot: Snapshot | null;
  panel: Panel;
  ingest: (snapshot: Snapshot) => void;
  setPanel: (panel: Panel) => void;
}
export const useChamber = create<ChamberState>(set => ({
  snapshot: null, panel: null,
  ingest: next => set(current => !current.snapshot || next.revision >= current.snapshot.revision ? { snapshot: next } : {}),
  setPanel: panel => set({ panel })
}));
