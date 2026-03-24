import { create } from "zustand";
import type { UserProfile } from "@/types/governance";

interface AppState {
  userProfile: UserProfile | null;
  setUserProfile: (profile: UserProfile) => void;
  clearUserProfile: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  userProfile: null,
  setUserProfile: (profile) => set({ userProfile: profile }),
  clearUserProfile: () => set({ userProfile: null }),
}));
