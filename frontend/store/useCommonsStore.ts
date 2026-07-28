import { create } from "zustand";
import { CommonsApiError, commonsApi } from "@/lib/api/commonsClient";
import {
  readCommonsOwnership,
  readOrCreateCommonsVisitorToken,
  removeCommonsOwnershipToken,
  writeCommonsOwnershipToken,
  type CommonsOwnershipTokens,
} from "@/lib/storage/commonsOwnership";
import {
  COMMONS_MESSAGE_MAX_LENGTH,
  countCommonsMessage,
  type CommonsCounts,
  type CommonsObjectKind,
  type CommonsReportCategory,
  type CommonsTrace,
} from "@/types/commons";

export const COMMONS_POLL_INTERVAL_MS = 20_000;

export type CommonsLoadStatus = "idle" | "loading" | "ready" | "empty" | "error";
export type CommonsPendingAction = "react" | "delete" | "report";

type LoadOptions = { background?: boolean };

type CommonsState = {
  dayKey: string | null;
  traces: CommonsTrace[];
  counts: CommonsCounts;
  status: CommonsLoadStatus;
  error: string | null;
  isRefreshing: boolean;
  isPolling: boolean;
  isSubmitting: boolean;
  submitError: string | null;
  actionError: string | null;
  pendingActions: Record<string, CommonsPendingAction>;
  ownershipTokens: CommonsOwnershipTokens;
  visitorToken: string | null;
  reactedTraceIds: string[];
  reportedTraceIds: string[];
  hydrateOwnership: () => void;
  ownsTrace: (traceId: string) => boolean;
  loadToday: (options?: LoadOptions) => Promise<void>;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;
  createGuestbook: (message: string) => Promise<CommonsTrace>;
  createInstallation: (message: string, objectKind: CommonsObjectKind) => Promise<CommonsTrace>;
  react: (traceId: string) => Promise<void>;
  deleteTrace: (traceId: string) => Promise<void>;
  reportTrace: (traceId: string, category: CommonsReportCategory) => Promise<void>;
  clearActionError: () => void;
  reset: () => void;
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let activeLoad: Promise<void> | null = null;
let loadGeneration = 0;

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function validateCommonsMessage(message: string) {
  const trimmed = message.trim();
  if (!trimmed) throw new Error("한 글자 이상 마음을 남겨주세요.");
  if (countCommonsMessage(trimmed) > COMMONS_MESSAGE_MAX_LENGTH) {
    throw new Error(`메시지는 ${COMMONS_MESSAGE_MAX_LENGTH}자까지 남길 수 있어요.`);
  }
  return trimmed;
}

export function friendlyCommonsError(error: unknown, fallback = "오늘의 흔적을 불러오지 못했어요.") {
  if (error instanceof CommonsApiError) {
    if (error.status === 403) return "이 흔적을 수정할 권한을 확인하지 못했어요.";
    if (error.status === 404) return "이미 사라졌거나 찾을 수 없는 흔적이에요.";
    if (error.status === 409) return "이미 공감했거나 처리된 흔적이에요.";
    if (error.status === 429) return "잠시 쉬었다가 다시 시도해주세요.";
    return error.message || fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function calculateCounts(traces: CommonsTrace[], provided?: Partial<CommonsCounts>): CommonsCounts {
  const guestbook = traces.filter((trace) => trace.kind === "guestbook").length;
  const installation = traces.filter((trace) => trace.kind === "installation").length;
  return {
    total: provided?.total ?? traces.length,
    guestbook: provided?.guestbook ?? guestbook,
    installation: provided?.installation ?? installation,
  };
}

function upsertTrace(traces: CommonsTrace[], nextTrace: CommonsTrace) {
  return [nextTrace, ...traces.filter((trace) => trace.id !== nextTrace.id)];
}

function initialState() {
  return {
    dayKey: null,
    traces: [] as CommonsTrace[],
    counts: { total: 0, guestbook: 0, installation: 0 },
    status: "idle" as CommonsLoadStatus,
    error: null,
    isRefreshing: false,
    isPolling: false,
    isSubmitting: false,
    submitError: null,
    actionError: null,
    pendingActions: {} as Record<string, CommonsPendingAction>,
    ownershipTokens: {} as CommonsOwnershipTokens,
    visitorToken: null,
    reactedTraceIds: [] as string[],
    reportedTraceIds: [] as string[],
  };
}

export const useCommonsStore = create<CommonsState>((set, get) => {
  const finishPending = (traceId: string, actionError: string | null = null) => {
    set((state) => {
      const pendingActions = { ...state.pendingActions };
      delete pendingActions[traceId];
      return { pendingActions, actionError };
    });
  };

  const getVisitorToken = () => {
    const token = get().visitorToken || readOrCreateCommonsVisitorToken(browserStorage());
    if (token !== get().visitorToken) set({ visitorToken: token });
    return token;
  };

  const createTrace = async (request: (visitorToken: string) => ReturnType<typeof commonsApi.createGuestbook>) => {
    set({ isSubmitting: true, submitError: null });
    try {
      const result = await request(getVisitorToken());
      const ownershipTokens = writeCommonsOwnershipToken(browserStorage(), result.trace.id, result.ownership_token);
      set((state) => {
        const traces = upsertTrace(state.traces, result.trace);
        return {
          traces,
          counts: calculateCounts(traces),
          status: "ready",
          ownershipTokens,
          isSubmitting: false,
          submitError: null,
        };
      });
      return result.trace;
    } catch (error) {
      const message = friendlyCommonsError(error, "흔적을 남기지 못했어요.");
      set({ isSubmitting: false, submitError: message });
      throw new Error(message);
    }
  };

  return {
    ...initialState(),

    hydrateOwnership: () => set({
      ownershipTokens: readCommonsOwnership(browserStorage()),
      visitorToken: readOrCreateCommonsVisitorToken(browserStorage()),
    }),
    ownsTrace: (traceId) => Boolean(get().ownershipTokens[traceId]),

    loadToday: async (options = {}) => {
      if (activeLoad) return activeLoad;
      const generation = loadGeneration;
      const background = options.background || get().status === "ready" || get().status === "empty";
      set({
        status: background ? get().status : "loading",
        isRefreshing: background,
        error: null,
      });

      const task = (async () => {
        try {
          const result = await commonsApi.today();
          if (generation !== loadGeneration) return;
          const traces = Array.isArray(result.traces) ? result.traces : [];
          set({
            dayKey: result.day_key,
            traces,
            counts: calculateCounts(traces, result.counts),
            status: traces.length > 0 ? "ready" : "empty",
            error: null,
            isRefreshing: false,
          });
        } catch (error) {
          if (generation !== loadGeneration) return;
          const message = friendlyCommonsError(error);
          set((state) => ({
            status: state.traces.length > 0 ? state.status : "error",
            error: message,
            isRefreshing: false,
          }));
        }
      })();

      activeLoad = task;
      try {
        await task;
      } finally {
        if (activeLoad === task) activeLoad = null;
      }
    },

    startPolling: (intervalMs = COMMONS_POLL_INTERVAL_MS) => {
      get().hydrateOwnership();
      if (pollTimer) clearInterval(pollTimer);
      set({ isPolling: true });
      void get().loadToday();
      pollTimer = setInterval(() => {
        void get().loadToday({ background: true });
      }, Math.max(5_000, intervalMs));
    },

    stopPolling: () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      set({ isPolling: false, isRefreshing: false });
    },

    createGuestbook: (message) => {
      const validMessage = validateCommonsMessage(message);
      return createTrace((visitorToken) => commonsApi.createGuestbook(validMessage, visitorToken));
    },

    createInstallation: (message, objectKind) => {
      const validMessage = validateCommonsMessage(message);
      return createTrace((visitorToken) => commonsApi.createInstallation(validMessage, objectKind, visitorToken));
    },

    react: async (traceId) => {
      const current = get().traces.find((trace) => trace.id === traceId);
      if (!current || get().reactedTraceIds.includes(traceId) || get().pendingActions[traceId]) return;
      set((state) => ({ pendingActions: { ...state.pendingActions, [traceId]: "react" }, actionError: null }));
      try {
        const result = await commonsApi.react(traceId, getVisitorToken());
        set((state) => ({
          traces: state.traces.map((trace) => trace.id === result.trace_id
            ? { ...trace, reaction_count: result.reaction_count }
            : trace),
          reactedTraceIds: state.reactedTraceIds.includes(result.trace_id)
            ? state.reactedTraceIds
            : [...state.reactedTraceIds, result.trace_id],
        }));
        finishPending(traceId);
      } catch (error) {
        finishPending(traceId, friendlyCommonsError(error, "공감을 전하지 못했어요."));
        throw error;
      }
    },

    deleteTrace: async (traceId) => {
      const ownershipToken = get().ownershipTokens[traceId];
      if (!ownershipToken) {
        const message = "내가 남긴 흔적만 지울 수 있어요.";
        set({ actionError: message });
        throw new Error(message);
      }
      if (get().pendingActions[traceId]) return;
      set((state) => ({ pendingActions: { ...state.pendingActions, [traceId]: "delete" }, actionError: null }));
      try {
        await commonsApi.remove(traceId, ownershipToken);
        const ownershipTokens = removeCommonsOwnershipToken(browserStorage(), traceId);
        set((state) => {
          const traces = state.traces.filter((trace) => trace.id !== traceId);
          return {
            traces,
            counts: calculateCounts(traces),
            status: traces.length > 0 ? "ready" : "empty",
            ownershipTokens,
          };
        });
        finishPending(traceId);
      } catch (error) {
        finishPending(traceId, friendlyCommonsError(error, "흔적을 지우지 못했어요."));
        throw error;
      }
    },

    reportTrace: async (traceId, category) => {
      if (get().reportedTraceIds.includes(traceId) || get().pendingActions[traceId]) return;
      set((state) => ({ pendingActions: { ...state.pendingActions, [traceId]: "report" }, actionError: null }));
      try {
        await commonsApi.report(traceId, category);
        set((state) => ({ reportedTraceIds: [...state.reportedTraceIds, traceId] }));
        finishPending(traceId);
      } catch (error) {
        finishPending(traceId, friendlyCommonsError(error, "신고를 접수하지 못했어요."));
        throw error;
      }
    },

    clearActionError: () => set({ actionError: null, submitError: null }),

    reset: () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      activeLoad = null;
      loadGeneration += 1;
      set(initialState());
    },
  };
});
