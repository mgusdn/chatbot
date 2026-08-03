"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

export const MEMORY_ROOM_REALTIME_DEBOUNCE_MS = 140;
export const MEMORY_ROOM_RECOVERY_POLL_MS = 15_000;

export type MemoryRoomRealtimeStatus =
  | "idle"
  | "connecting"
  | "subscribed"
  | "recovering";

export function shouldRefreshMemoryRoom(loadedRevision: number | null, incomingRevision: unknown) {
  const revision = typeof incomingRevision === "number"
    ? incomingRevision
    : typeof incomingRevision === "string"
      ? Number(incomingRevision)
      : Number.NaN;
  return Number.isSafeInteger(revision) && revision >= 0
    && (loadedRevision === null || revision > loadedRevision);
}

type UseMemoryRoomRealtimeOptions = {
  enabled: boolean;
  roomSlug: string;
  revision: number | null;
  refresh: () => Promise<void>;
};

export function useMemoryRoomRealtime({
  enabled,
  roomSlug,
  revision,
  refresh,
}: UseMemoryRoomRealtimeOptions): MemoryRoomRealtimeStatus {
  const refreshRef = useRef(refresh);
  const revisionRef = useRef(revision);
  const [status, setStatus] = useState<MemoryRoomRealtimeStatus>("idle");

  refreshRef.current = refresh;
  revisionRef.current = revision;

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    const client = getSupabaseBrowserClient();
    let disposed = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshing = false;
    let refreshQueued = false;

    const runRefresh = async () => {
      if (disposed) return;
      if (refreshing) {
        refreshQueued = true;
        return;
      }
      refreshing = true;
      try {
        await refreshRef.current();
      } finally {
        refreshing = false;
        if (refreshQueued && !disposed) {
          refreshQueued = false;
          void runRefresh();
        }
      }
    };

    const queueRefresh = (immediate = false) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void runRefresh(), immediate ? 0 : MEMORY_ROOM_REALTIME_DEBOUNCE_MS);
    };

    const recover = () => {
      if (document.visibilityState === "visible") queueRefresh(true);
    };
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", recover);

    const recoveryPoll = setInterval(() => {
      if (document.visibilityState === "visible") queueRefresh(true);
    }, MEMORY_ROOM_RECOVERY_POLL_MS);

    if (!client) {
      setStatus("recovering");
      queueRefresh(true);
      return () => {
        disposed = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        clearInterval(recoveryPoll);
        window.removeEventListener("focus", recover);
        document.removeEventListener("visibilitychange", recover);
      };
    }

    setStatus("connecting");
    const channel = client
      .channel(`memory-room-revision:${roomSlug}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "memory_room_revisions",
        },
        (payload) => {
          const next = payload.new as { slug?: unknown; revision?: unknown } | null;
          if (next?.slug !== roomSlug) return;
          const incoming = next.revision;
          if (shouldRefreshMemoryRoom(revisionRef.current, incoming)) queueRefresh();
        },
      )
      .subscribe((nextStatus) => {
        if (disposed) return;
        if (nextStatus === "SUBSCRIBED") {
          setStatus("subscribed");
          // Closes the load-before-subscribe race and repairs missed events
          // after the Supabase client reconnects.
          queueRefresh(true);
        } else if (nextStatus === "CHANNEL_ERROR" || nextStatus === "TIMED_OUT" || nextStatus === "CLOSED") {
          setStatus("recovering");
        }
      });

    return () => {
      disposed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(recoveryPoll);
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", recover);
      void client.removeChannel(channel);
      setStatus("idle");
    };
  }, [enabled, roomSlug]);

  return status;
}
