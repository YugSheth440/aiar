import { create } from 'zustand';

export type AppState = 'ready' | 'analyzing' | 'hazard' | 'guidance' | 'critical';

interface SceneState {
  capsuleState: AppState;
  activeHazards: any[]; // TODO: Replace with typed Hazard interface
  arOverlays: any[];    // TODO: Replace with typed AROverlay interface
  overallRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  setCapsuleState: (state: AppState) => void;
  setSceneData: (hazards: any[], overlays: any[], risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL') => void;
}

export const useSceneStore = create<SceneState>((set) => ({
  capsuleState: 'ready',
  activeHazards: [],
  arOverlays: [],
  overallRisk: 'LOW',
  setCapsuleState: (capsuleState) => set({ capsuleState }),
  setSceneData: (activeHazards, arOverlays, overallRisk) => set({ activeHazards, arOverlays, overallRisk }),
}));
