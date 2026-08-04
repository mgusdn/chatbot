import type { CharacterId } from "./character";

export type MultiplayerStatus = "idle" | "connecting" | "subscribed" | "recovering";

export type LocalPlayerTelemetry = {
  ready: boolean;
  position: [number, number, number];
  rotationY: number;
  moving: boolean;
  running: boolean;
};

export type MultiplayerPlayerState = {
  playerId: string;
  connectionId: string;
  characterId: CharacterId;
  nickname: string;
  scene: "interior";
  position: [number, number, number];
  rotationY: number;
  moving: boolean;
  running: boolean;
  sequence: number;
  sentAt: number;
};

export type RemotePlayerState = MultiplayerPlayerState & {
  lastSeenAt: number;
};
