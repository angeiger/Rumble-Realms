/** Whether the reward pack dialog is open, and which pack to show first. Not persisted. */
import { create } from 'zustand';

export interface PackUiStore {
  open: boolean;
  /** Pack to show first (e.g. the one of the match just won); null = the oldest. */
  preferId: string | null;
  show: (preferId?: string | null) => void;
  close: () => void;
}

export const usePackUi = create<PackUiStore>()((set) => ({
  open: false,
  preferId: null,
  show: (preferId = null) => set({ open: true, preferId }),
  close: () => set({ open: false, preferId: null }),
}));
