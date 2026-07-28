import type { CharacterId } from "./character";

export type GameScene = "exterior" | "interior";

export type GamePhase =
  | "entry"
  | "character-select"
  | "preloading"
  | "spawning"
  | "exploring-exterior"
  | "entering-building"
  | "exploring-interior"
  | "interaction-ready"
  | "entering-counsel"
  | "counsel-active"
  | "leaving-counsel"
  | "report-active"
  | "world-error";

export type InteractableId =
  | "counseling-house"
  | "pbao"
  | "exit-house"
  | "guestbook"
  | "installation";

export type CommonsStation = Extract<InteractableId, "guestbook" | "installation">;

export type TransformSnapshot = {
  scene: GameScene;
  position: [number, number, number];
  rotationY: number;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
};

export type GameEvent =
  | { type: "START_CLICK" }
  | { type: "SELECT_CHARACTER"; characterId: CharacterId }
  | { type: "CONFIRM_CHARACTER" }
  | { type: "WORLD_READY" }
  | { type: "ENTER_BUILDING" }
  | { type: "ENTER_NPC_RANGE" }
  | { type: "LEAVE_NPC_RANGE" }
  | { type: "INTERACT" }
  | { type: "TRANSITION_DONE" }
  | { type: "COUNSEL_COMPLETE" }
  | { type: "CLOSE_COUNSEL" }
  | { type: "RETURN_DONE"; scene?: GameScene }
  | { type: "REPORT_READY" }
  | { type: "DISMISS_REPORT"; scene?: GameScene };
