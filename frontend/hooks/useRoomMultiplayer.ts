"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import {
  MULTIPLAYER_HEARTBEAT_MS,
  MULTIPLAYER_LEAVE_GRACE_MS,
  MULTIPLAYER_REMOTE_TTL_MS,
  MULTIPLAYER_SEND_INTERVAL_MS,
  cloneLocalPlayerTelemetry,
  createInitialLocalPlayerTelemetry,
  getOrCreateMultiplayerPlayerId,
  hasLocalPlayerTelemetryChanged,
  parseMultiplayerPlayerState,
  shouldAcceptRemotePlayerState,
} from "@/lib/multiplayer/playerState";
import type { CharacterId } from "@/types/character";
import type {
  LocalPlayerTelemetry,
  MultiplayerPlayerState,
  MultiplayerStatus,
  RemotePlayerState,
} from "@/types/multiplayer";

type UseRoomMultiplayerOptions = {
  enabled: boolean;
  roomSlug: string;
  characterId: CharacterId;
  nickname: string;
};

type UseRoomMultiplayerResult = {
  status: MultiplayerStatus;
  playerId: string | null;
  localPlayerTelemetryRef: MutableRefObject<LocalPlayerTelemetry>;
  remotePlayers: RemotePlayerState[];
};

const randomId = () => crypto.randomUUID();
const channelCleanupByTopic = new Map<string, Promise<void>>();

export function useRoomMultiplayer({
  enabled,
  roomSlug,
  characterId,
  nickname,
}: UseRoomMultiplayerOptions): UseRoomMultiplayerResult {
  const localPlayerTelemetryRef = useRef<LocalPlayerTelemetry>(createInitialLocalPlayerTelemetry());
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [status, setStatus] = useState<MultiplayerStatus>("idle");
  const [remotePlayersById, setRemotePlayersById] = useState<Record<string, RemotePlayerState>>({});
  const remotePlayersRef = useRef(remotePlayersById);

  useEffect(() => {
    try {
      setPlayerId(getOrCreateMultiplayerPlayerId(window.sessionStorage, randomId));
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
      // The in-memory id still keeps this tab distinct for the current visit.
      setPlayerId(randomId());
    }
  }, []);

  useEffect(() => {
    remotePlayersRef.current = remotePlayersById;
  }, [remotePlayersById]);

  useEffect(() => {
    if (!enabled || !playerId) {
      setStatus("idle");
      setRemotePlayersById({});
      return;
    }

    const client = getSupabaseBrowserClient();
    if (!client) {
      setStatus("recovering");
      return;
    }

    const connectionId = randomId();
    const channelTopic = `room:${roomSlug}:players:v1`;
    let disposed = false;
    let connected = false;
    let sending = false;
    let sendQueued = false;
    let sequence = 0;
    let lastSentAt = 0;
    let lastSentTelemetry: LocalPlayerTelemetry | null = null;
    let lastStateRequestAt = 0;
    const leaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

    const updateRemotePlayer = (payload: unknown) => {
      const incoming = parseMultiplayerPlayerState(payload);
      if (!incoming || incoming.playerId === playerId) return;
      const now = Date.now();
      const leaveTimer = leaveTimers.get(incoming.playerId);
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimers.delete(incoming.playerId);
      }
      setRemotePlayersById((current) => {
        const previous = current[incoming.playerId];
        if (!shouldAcceptRemotePlayerState(previous, incoming)) return current;
        return {
          ...current,
          [incoming.playerId]: { ...incoming, lastSeenAt: now },
        };
      });
    };

    const removeRemotePlayer = (remotePlayerId: string, expectedConnectionId?: string) => {
      setRemotePlayersById((current) => {
        const existing = current[remotePlayerId];
        if (!existing || (expectedConnectionId && existing.connectionId !== expectedConnectionId)) return current;
        const next = { ...current };
        delete next[remotePlayerId];
        return next;
      });
    };

    let channel: RealtimeChannel | null = null;

    const sendLocalState = async (force = false) => {
      const activeChannel = channel;
      if (!connected || disposed || !activeChannel) return;
      const telemetry = localPlayerTelemetryRef.current;
      if (!telemetry.ready) return;
      const now = Date.now();
      const heartbeatDue = now - lastSentAt >= MULTIPLAYER_HEARTBEAT_MS;
      if (!force && !heartbeatDue && !hasLocalPlayerTelemetryChanged(lastSentTelemetry, telemetry)) return;
      if (sending) {
        sendQueued = true;
        return;
      }

      sending = true;
      const payload: MultiplayerPlayerState = {
        playerId,
        connectionId,
        characterId,
        nickname: nickname.trim().slice(0, 24) || "방문자",
        scene: "interior",
        position: [...telemetry.position],
        rotationY: telemetry.rotationY,
        moving: telemetry.moving,
        running: telemetry.running,
        sequence: sequence++,
        sentAt: now,
      };
      lastSentTelemetry = cloneLocalPlayerTelemetry(telemetry);
      lastSentAt = now;
      try {
        const result = await activeChannel.send({
          type: "broadcast",
          event: "player-state",
          payload,
        });
        if (result !== "ok" && !disposed) setStatus("recovering");
      } catch {
        if (!disposed) setStatus("recovering");
      } finally {
        sending = false;
        if (sendQueued && !disposed) {
          sendQueued = false;
          void sendLocalState();
        }
      }
    };

    const requestPlayerStates = () => {
      const activeChannel = channel;
      if (!connected || disposed || !activeChannel) return;
      const now = Date.now();
      if (now - lastStateRequestAt < 250) return;
      lastStateRequestAt = now;
      void activeChannel
        .send({
          type: "broadcast",
          event: "player-state-request",
          payload: { requesterId: playerId, connectionId },
        })
        .catch(() => {
          if (!disposed) setStatus("recovering");
        });
    };

    const schedulePresenceLeave = (remotePlayerId: string, expectedConnectionId?: string) => {
      if (remotePlayerId === playerId) return;
      const previous = leaveTimers.get(remotePlayerId);
      if (previous) clearTimeout(previous);
      const observedAt = remotePlayersRef.current[remotePlayerId]?.lastSeenAt ?? 0;
      leaveTimers.set(remotePlayerId, setTimeout(() => {
        leaveTimers.delete(remotePlayerId);
        const current = remotePlayersRef.current[remotePlayerId];
        if (!current || current.lastSeenAt > observedAt) return;
        removeRemotePlayer(remotePlayerId, expectedConnectionId);
      }, MULTIPLAYER_LEAVE_GRACE_MS));
    };

    setStatus("connecting");
    void (async () => {
      const previousCleanup = channelCleanupByTopic.get(channelTopic);
      if (previousCleanup) await previousCleanup;
      if (disposed) return;

      const staleChannel = client.getChannels().find(
        (candidate) => candidate.topic === `realtime:${channelTopic}`,
      );
      if (staleChannel) {
        await client.removeChannel(staleChannel);
        staleChannel.teardown();
      }
      if (disposed) return;

      const nextChannel = client.channel(channelTopic, {
        config: {
          presence: { key: playerId },
          broadcast: { self: false },
        },
      });
      channel = nextChannel;
      nextChannel
        .on("broadcast", { event: "player-state" }, ({ payload }) => updateRemotePlayer(payload))
        .on("broadcast", { event: "player-state-request" }, ({ payload }) => {
          const request = payload as { requesterId?: unknown } | null;
          if (request?.requesterId !== playerId) void sendLocalState(true);
        })
        .on("broadcast", { event: "player-left" }, ({ payload }) => {
          const leaving = payload as { playerId?: unknown; connectionId?: unknown } | null;
          if (typeof leaving?.playerId !== "string") return;
          removeRemotePlayer(
            leaving.playerId,
            typeof leaving.connectionId === "string" ? leaving.connectionId : undefined,
          );
        })
        .on("presence", { event: "sync" }, requestPlayerStates)
        .on("presence", { event: "join" }, ({ key }) => {
          if (key !== playerId) requestPlayerStates();
        })
        .on("presence", { event: "leave" }, ({ key, leftPresences }) => {
          const connection = Array.isArray(leftPresences)
            ? (leftPresences[0] as { connectionId?: unknown } | undefined)?.connectionId
            : undefined;
          schedulePresenceLeave(key, typeof connection === "string" ? connection : undefined);
        })
        .subscribe((nextStatus) => {
          if (disposed) return;
          if (nextStatus === "SUBSCRIBED") {
            connected = true;
            setStatus("subscribed");
            void nextChannel
              .track({ playerId, connectionId, characterId, nickname, scene: "interior" })
              .then((trackStatus) => {
                if (trackStatus !== "ok" && !disposed) setStatus("recovering");
              })
              .catch(() => {
                if (!disposed) setStatus("recovering");
              });
            requestPlayerStates();
            void sendLocalState(true);
          } else if (
            nextStatus === "CHANNEL_ERROR"
            || nextStatus === "TIMED_OUT"
            || nextStatus === "CLOSED"
          ) {
            connected = false;
            setStatus("recovering");
          }
        });
    })().catch(() => {
      if (!disposed) setStatus("recovering");
    });

    const sendTimer = setInterval(() => void sendLocalState(), MULTIPLAYER_SEND_INTERVAL_MS);
    const staleTimer = setInterval(() => {
      const cutoff = Date.now() - MULTIPLAYER_REMOTE_TTL_MS;
      setRemotePlayersById((current) => {
        const entries = Object.entries(current).filter(([, player]) => player.lastSeenAt >= cutoff);
        if (entries.length === Object.keys(current).length) return current;
        return Object.fromEntries(entries);
      });
    }, 1_000);
    const wake = () => {
      if (document.visibilityState === "visible") {
        requestPlayerStates();
        void sendLocalState(true);
      }
    };
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);

    return () => {
      disposed = true;
      const wasConnected = connected;
      connected = false;
      clearInterval(sendTimer);
      clearInterval(staleTimer);
      leaveTimers.forEach(clearTimeout);
      leaveTimers.clear();
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      setRemotePlayersById({});
      setStatus("idle");
      const activeChannel = channel;
      if (!activeChannel) return;
      const cleanup = (async () => {
        try {
          if (wasConnected) {
            await activeChannel.send({
              type: "broadcast",
              event: "player-left",
              payload: { playerId, connectionId },
            });
            await activeChannel.untrack();
          }
          await client.removeChannel(activeChannel);
        } finally {
          // Supabase reuses channels by topic. Force teardown even when the
          // leave acknowledgement times out so Strict Mode can subscribe a
          // fresh channel without inheriting joinedOnce/presence bindings.
          activeChannel.teardown();
        }
      })().catch(() => {
        // Channel cleanup is best effort; the heartbeat TTL removes stale peers.
      });
      channelCleanupByTopic.set(channelTopic, cleanup);
      void cleanup.finally(() => {
        if (channelCleanupByTopic.get(channelTopic) === cleanup) {
          channelCleanupByTopic.delete(channelTopic);
        }
      });
    };
  }, [characterId, enabled, nickname, playerId, roomSlug]);

  const remotePlayers = useMemo(
    () => Object.values(remotePlayersById),
    [remotePlayersById],
  );

  return { status, playerId, localPlayerTelemetryRef, remotePlayers };
}
