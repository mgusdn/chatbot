import { create } from "zustand";
import type { CharacterId } from "@/types/character";
import type { CounselReport } from "@/types/counseling";
import { cloneTransformSnapshot, explorationPhaseForScene, isWorldInputPhase } from "@/lib/gameState";
import type { CommonsStation, GamePhase, GameScene, InteractableId, TransformSnapshot } from "@/types/game";

type GameState = {
  phase: GamePhase;
  scene: GameScene;
  selectedCharacterId: CharacterId | null;
  confirmedCharacterId: CharacterId | null;
  nearbyInteractable: InteractableId | null;
  interactionNonce: number;
  pendingInteraction: { nonce: number; target: InteractableId } | null;
  mobileMove: [number, number];
  muted: boolean;
  assetsProgress: number;
  returnSnapshot: TransformSnapshot | null;
  counselReport: CounselReport | null;
  lastCounselReport: CounselReport | null;
  activeCommonsStation: CommonsStation | null;
  error: string | null;
  start: () => void;
  hydrateCharacter: (characterId: CharacterId | null) => void;
  selectCharacter: (characterId: CharacterId) => void;
  confirmCharacter: () => CharacterId | null;
  setAssetsProgress: (progress: number) => void;
  enterWorld: () => void;
  finishSpawn: () => void;
  setNearbyInteractable: (target: InteractableId | null) => void;
  requestInteraction: () => void;
  consumeInteraction: () => InteractableId | null;
  setMobileMove: (move: [number, number]) => void;
  beginBuildingTransition: () => void;
  enterInterior: () => void;
  exitInterior: () => void;
  beginCounsel: (snapshot: TransformSnapshot) => void;
  activateCounsel: () => void;
  completeCounsel: (report: CounselReport) => void;
  closeCounsel: () => void;
  clearReturnSnapshot: () => void;
  finishCounselReturn: () => void;
  dismissCounselReport: () => void;
  reopenLastReport: () => void;
  openCommonsStation: (station: CommonsStation) => void;
  closeCommonsStation: () => void;
  toggleMuted: () => void;
  changeCharacter: () => void;
  setError: (message: string | null) => void;
  reset: () => void;
};

const initialState = {
  phase: "entry" as GamePhase,
  scene: "exterior" as const,
  selectedCharacterId: null,
  confirmedCharacterId: null,
  nearbyInteractable: null,
  interactionNonce: 0,
  pendingInteraction: null,
  mobileMove: [0, 0] as [number, number],
  muted: true,
  assetsProgress: 0,
  returnSnapshot: null,
  counselReport: null,
  lastCounselReport: null,
  activeCommonsStation: null,
  error: null,
};

export const useGameStore = create<GameState>((set, get) => ({
  ...initialState,
  start: () => set({ phase: "character-select" }),
  hydrateCharacter: (characterId) =>
    set((state) => ({
      selectedCharacterId: state.selectedCharacterId ?? characterId,
    })),
  selectCharacter: (selectedCharacterId) => set({ selectedCharacterId }),
  confirmCharacter: () => {
    const selected = get().selectedCharacterId;
    if (!selected) return null;
    set({ confirmedCharacterId: selected, phase: "preloading", assetsProgress: 12, error: null });
    return selected;
  },
  setAssetsProgress: (assetsProgress) => set({ assetsProgress: Math.max(0, Math.min(100, assetsProgress)) }),
  enterWorld: () => set({ phase: "spawning", scene: "exterior", assetsProgress: 100 }),
  finishSpawn: () => set({ phase: "exploring-exterior", scene: "exterior" }),
  setNearbyInteractable: (nearbyInteractable) =>
    set((state) => {
      if (!isWorldInputPhase(state.phase)) return state;
      if (state.nearbyInteractable === nearbyInteractable) return state;
      const basePhase = explorationPhaseForScene(state.scene);
      return {
        nearbyInteractable,
        phase: nearbyInteractable ? "interaction-ready" : basePhase,
      };
    }),
  requestInteraction: () => set((state) => {
    if (state.phase !== "interaction-ready" || !state.nearbyInteractable) return state;
    const nonce = state.interactionNonce + 1;
    return {
      interactionNonce: nonce,
      pendingInteraction: { nonce, target: state.nearbyInteractable },
    };
  }),
  consumeInteraction: () => {
    const pending = get().pendingInteraction;
    if (!pending) return null;
    set({ pendingInteraction: null });
    return pending.target;
  },
  setMobileMove: (mobileMove) => set((state) => {
    if (!isWorldInputPhase(state.phase)) {
      return state.mobileMove[0] === 0 && state.mobileMove[1] === 0 ? state : { mobileMove: [0, 0] };
    }
    return { mobileMove };
  }),
  beginBuildingTransition: () => set({ phase: "entering-building", nearbyInteractable: null, pendingInteraction: null }),
  enterInterior: () => set({ phase: "exploring-interior", scene: "interior", nearbyInteractable: null, activeCommonsStation: null }),
  exitInterior: () => set({ phase: "exploring-exterior", scene: "exterior", nearbyInteractable: null, activeCommonsStation: null }),
  beginCounsel: (returnSnapshot) => set((state) => {
    if (state.phase !== "interaction-ready" || state.nearbyInteractable !== "pbao") return state;
    return {
      phase: "entering-counsel",
      returnSnapshot: cloneTransformSnapshot(returnSnapshot),
      counselReport: null,
      activeCommonsStation: null,
      nearbyInteractable: null,
      mobileMove: [0, 0],
      pendingInteraction: null,
    };
  }),
  activateCounsel: () => set({ phase: "counsel-active" }),
  completeCounsel: (counselReport) => set((state) => {
    if (state.phase !== "counsel-active") return state;
    return { phase: "leaving-counsel", counselReport, lastCounselReport: counselReport, nearbyInteractable: null, mobileMove: [0, 0] };
  }),
  closeCounsel: () => set((state) => {
    if (state.phase !== "counsel-active") return state;
    return { phase: "leaving-counsel", counselReport: null, nearbyInteractable: null, mobileMove: [0, 0] };
  }),
  clearReturnSnapshot: () => set({ returnSnapshot: null }),
  finishCounselReturn: () => set((state) => {
    if (state.phase !== "leaving-counsel") return state;
    const scene = state.returnSnapshot?.scene || state.scene;
    if (!state.counselReport) {
      return {
        phase: explorationPhaseForScene(scene),
        scene,
        counselReport: null,
        nearbyInteractable: null,
        mobileMove: [0, 0],
      };
    }
    return {
      phase: "report-active",
      scene,
      nearbyInteractable: null,
      mobileMove: [0, 0],
    };
  }),
  dismissCounselReport: () => set((state) => {
    if (state.phase !== "report-active") return state;
    const scene = state.returnSnapshot?.scene || state.scene;
    return {
      phase: explorationPhaseForScene(scene),
      scene,
      counselReport: null,
      nearbyInteractable: null,
      mobileMove: [0, 0],
    };
  }),
  reopenLastReport: () => set((state) => {
    if (!state.lastCounselReport || !isWorldInputPhase(state.phase)) return state;
    return {
      phase: "report-active",
      counselReport: state.lastCounselReport,
      nearbyInteractable: null,
      mobileMove: [0, 0],
    };
  }),
  openCommonsStation: (activeCommonsStation) => set({ activeCommonsStation, mobileMove: [0, 0], pendingInteraction: null }),
  closeCommonsStation: () => set({ activeCommonsStation: null, mobileMove: [0, 0] }),
  toggleMuted: () => set((state) => ({ muted: !state.muted })),
  changeCharacter: () => set({ phase: "character-select", nearbyInteractable: null, pendingInteraction: null, counselReport: null, lastCounselReport: null, returnSnapshot: null, activeCommonsStation: null, mobileMove: [0, 0] }),
  setError: (error) => set({ error, phase: error ? "world-error" : get().phase }),
  reset: () => set(initialState),
}));
