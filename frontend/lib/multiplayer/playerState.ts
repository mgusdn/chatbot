import {
  INTERIOR_HALF_DEPTH,
  INTERIOR_HALF_WIDTH,
} from "@/constants/interiorLayout";
import { CHARACTER_BY_ID, isCharacterId } from "@/constants/characterCatalog";
import type {
  LocalPlayerTelemetry,
  MultiplayerPlayerState,
  RemotePlayerState,
} from "@/types/multiplayer";

export const MULTIPLAYER_SESSION_KEY = "pume-multiplayer-player-id";
export const MULTIPLAYER_SEND_INTERVAL_MS = 125;
export const MULTIPLAYER_HEARTBEAT_MS = 1_000;
export const MULTIPLAYER_REMOTE_TTL_MS = 10_000;
export const MULTIPLAYER_LEAVE_GRACE_MS = 1_500;

const MAX_ID_LENGTH = 128;
const MAX_NICKNAME_LENGTH = 24;
const POSITION_EPSILON_SQ = 0.02 ** 2;
const ROTATION_EPSILON = 0.02;

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === "number" && Number.isFinite(value)
);

const isOpaqueId = (value: unknown): value is string => (
  typeof value === "string"
  && value.length > 0
  && value.length <= MAX_ID_LENGTH
  && /^[a-zA-Z0-9:_-]+$/.test(value)
);

export function getOrCreateMultiplayerPlayerId(
  storage: Pick<Storage, "getItem" | "setItem">,
  createId: () => string,
) {
  const existing = storage.getItem(MULTIPLAYER_SESSION_KEY);
  if (isOpaqueId(existing)) return existing;

  const next = createId();
  if (!isOpaqueId(next)) throw new Error("멀티플레이 플레이어 ID를 만들지 못했어요.");
  storage.setItem(MULTIPLAYER_SESSION_KEY, next);
  return next;
}

export function createInitialLocalPlayerTelemetry(): LocalPlayerTelemetry {
  return {
    ready: false,
    position: [0, 0.78, 0],
    rotationY: 0,
    moving: false,
    running: false,
  };
}

function parsePosition(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) return null;
  const [x, y, z] = value;
  if (
    Math.abs(x) > INTERIOR_HALF_WIDTH + 2
    || Math.abs(z) > INTERIOR_HALF_DEPTH + 2
    || y < -2
    || y > 8
  ) return null;
  return [x, y, z];
}

export function parseMultiplayerPlayerState(payload: unknown): MultiplayerPlayerState | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Record<string, unknown>;
  const position = parsePosition(candidate.position);
  if (
    !isOpaqueId(candidate.playerId)
    || !isOpaqueId(candidate.connectionId)
    || !isCharacterId(candidate.characterId)
    || CHARACTER_BY_ID[candidate.characterId].selectable === false
    || candidate.scene !== "interior"
    || !position
    || !isFiniteNumber(candidate.rotationY)
    || typeof candidate.moving !== "boolean"
    || typeof candidate.running !== "boolean"
    || !Number.isSafeInteger(candidate.sequence)
    || (candidate.sequence as number) < 0
    || !isFiniteNumber(candidate.sentAt)
  ) return null;

  const nickname = typeof candidate.nickname === "string"
    ? candidate.nickname.trim().slice(0, MAX_NICKNAME_LENGTH)
    : "";

  return {
    playerId: candidate.playerId,
    connectionId: candidate.connectionId,
    characterId: candidate.characterId,
    nickname: nickname || "방문자",
    scene: "interior",
    position,
    rotationY: candidate.rotationY,
    moving: candidate.moving,
    running: candidate.running,
    sequence: candidate.sequence as number,
    sentAt: candidate.sentAt,
  };
}

export function shouldAcceptRemotePlayerState(
  previous: RemotePlayerState | undefined,
  incoming: MultiplayerPlayerState,
) {
  if (!previous) return true;
  if (previous.connectionId !== incoming.connectionId) return true;
  return incoming.sequence > previous.sequence;
}

function shortestAngleDistance(a: number, b: number) {
  const fullTurn = Math.PI * 2;
  return Math.abs(((a - b + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI);
}

export function hasLocalPlayerTelemetryChanged(
  previous: LocalPlayerTelemetry | null,
  current: LocalPlayerTelemetry,
) {
  if (!previous || !previous.ready || !current.ready) return previous?.ready !== current.ready;
  const dx = current.position[0] - previous.position[0];
  const dy = current.position[1] - previous.position[1];
  const dz = current.position[2] - previous.position[2];
  return dx * dx + dy * dy + dz * dz > POSITION_EPSILON_SQ
    || shortestAngleDistance(current.rotationY, previous.rotationY) > ROTATION_EPSILON
    || current.moving !== previous.moving
    || current.running !== previous.running;
}

export function cloneLocalPlayerTelemetry(current: LocalPlayerTelemetry): LocalPlayerTelemetry {
  return {
    ...current,
    position: [...current.position],
  };
}
