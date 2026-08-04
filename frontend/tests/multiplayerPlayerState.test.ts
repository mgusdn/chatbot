import { describe, expect, it } from "vitest";
import {
  MULTIPLAYER_SESSION_KEY,
  createInitialLocalPlayerTelemetry,
  getOrCreateMultiplayerPlayerId,
  hasLocalPlayerTelemetryChanged,
  parseMultiplayerPlayerState,
  shouldAcceptRemotePlayerState,
} from "@/lib/multiplayer/playerState";
import type { MultiplayerPlayerState, RemotePlayerState } from "@/types/multiplayer";

const validState = (overrides: Partial<MultiplayerPlayerState> = {}): MultiplayerPlayerState => ({
  playerId: "player-a",
  connectionId: "connection-a",
  characterId: "snowy",
  nickname: "하얀 토끼",
  scene: "interior",
  position: [1, 0.78, -2],
  rotationY: 1.25,
  moving: true,
  running: false,
  sequence: 3,
  sentAt: 1_000,
  ...overrides,
});

describe("multiplayer player state", () => {
  it("creates one automatic id per session storage and then reuses it", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(getOrCreateMultiplayerPlayerId(storage, () => "generated-one")).toBe("generated-one");
    expect(values.get(MULTIPLAYER_SESSION_KEY)).toBe("generated-one");
    expect(getOrCreateMultiplayerPlayerId(storage, () => "generated-two")).toBe("generated-one");
  });

  it("accepts bounded playable states and normalizes the nickname", () => {
    expect(parseMultiplayerPlayerState(validState({ nickname: "  토끼 친구  " }))).toMatchObject({
      nickname: "토끼 친구",
      characterId: "snowy",
      position: [1, 0.78, -2],
    });
  });

  it("rejects malformed, out-of-room, and non-selectable character payloads", () => {
    expect(parseMultiplayerPlayerState(validState({ position: [999, 0, 0] }))).toBeNull();
    expect(parseMultiplayerPlayerState(validState({ rotationY: Number.NaN }))).toBeNull();
    expect(parseMultiplayerPlayerState(validState({ characterId: "rabbit" }))).toBeNull();
    expect(parseMultiplayerPlayerState({ ...validState(), sequence: -1 })).toBeNull();
  });

  it("drops stale packets but accepts a refreshed connection with a reset sequence", () => {
    const previous: RemotePlayerState = { ...validState(), lastSeenAt: 1_000 };
    expect(shouldAcceptRemotePlayerState(previous, validState({ sequence: 4 }))).toBe(true);
    expect(shouldAcceptRemotePlayerState(previous, validState({ sequence: 3 }))).toBe(false);
    expect(shouldAcceptRemotePlayerState(previous, validState({ sequence: 2 }))).toBe(false);
    expect(shouldAcceptRemotePlayerState(previous, validState({ connectionId: "connection-b", sequence: 0 }))).toBe(true);
  });

  it("sends only meaningful movement changes between heartbeats", () => {
    const previous = {
      ...createInitialLocalPlayerTelemetry(),
      ready: true,
      position: [0, 0.78, 0] as [number, number, number],
    };
    expect(hasLocalPlayerTelemetryChanged(previous, { ...previous })).toBe(false);
    expect(hasLocalPlayerTelemetryChanged(previous, {
      ...previous,
      position: [0.1, 0.78, 0],
    })).toBe(true);
    expect(hasLocalPlayerTelemetryChanged(previous, { ...previous, moving: true })).toBe(true);
    expect(hasLocalPlayerTelemetryChanged(previous, { ...previous, rotationY: 0.1 })).toBe(true);
  });
});
