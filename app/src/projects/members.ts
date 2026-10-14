import { create } from 'zustand';

import { api } from '@/api/client';
import { useOrganizationStore } from '@/organization/store';

export interface Member {
  id: number;
  name: string;
}

// How long a loaded list is reused before the next open refreshes it.
export const MEMBER_DIRECTORY_TTL_MS = 5 * 60 * 1000;

interface Entry {
  members: Member[];
  loadedAt: number;
  inFlight: Promise<void> | null;
}

interface MemberDirectoryState {
  entries: Record<number, Entry>;
  ensureLoaded(projectId: number | null | undefined): Promise<void>;
  clear(): void;
}

let epoch = 0;

export const useMemberDirectoryStore = create<MemberDirectoryState>()((set, get) => ({
  entries: {},

  ensureLoaded(projectId) {
    if (projectId == null || useOrganizationStore.getState().activeId === null) return Promise.resolve();
    const existing = get().entries[projectId];
    if (existing && existing.loadedAt > 0 && Date.now() - existing.loadedAt < MEMBER_DIRECTORY_TTL_MS) {
      return Promise.resolve();
    }
    if (existing?.inFlight) return existing.inFlight;
    const mine = epoch;
    const patch = (entry: Partial<Entry>) => {
      if (mine !== epoch) return;
      const current = get().entries[projectId] ?? { members: [], loadedAt: 0, inFlight: null };
      set({ entries: { ...get().entries, [projectId]: { ...current, ...entry } } });
    };
    const request = api
      .get<{ data: Member[] }>(`/api/projects/${projectId}/members`)
      .then((response) => patch({ members: response.data, loadedAt: Date.now(), inFlight: null }))
      .catch(() => patch({ inFlight: null }));
    patch({ inFlight: request });
    return request;
  },

  clear() {
    epoch++;
    set({ entries: {} });
  },
}));

useOrganizationStore.subscribe((state, previous) => {
  if (state.activeId !== previous.activeId) useMemberDirectoryStore.getState().clear();
});
