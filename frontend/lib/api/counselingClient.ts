import type {
  ExperimentResponse,
  HealthResponse,
  ModelArm,
  PublicCounselState,
  TurnStreamEvent,
  TurnResponse,
} from "@/types/counseling";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: string };
      detail = body.detail || detail;
    } catch {
      // Keep the HTTP status when the response is not JSON.
    }
    const error = new Error(detail) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as T;
}

async function streamError(response: Response) {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

export async function readTurnEventStream(
  response: Response,
  onEvent: (event: TurnStreamEvent) => void,
): Promise<TurnResponse> {
  if (!response.ok) throw new Error(await streamError(response));
  if (!response.body) throw new Error("스트리밍 응답 본문이 없습니다.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: TurnResponse | null = null;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as TurnStreamEvent;
    onEvent(event);
    if (event.type === "complete") completed = event;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    lines.forEach(consumeLine);
    if (done) break;
  }
  consumeLine(buffer);
  if (!completed) throw new Error("상담 스트림이 최종 결과 없이 종료되었습니다.");
  return completed;
}

export const counselingApi = {
  health: (probe = true) => api<HealthResponse>(`/api/health?probe=${probe}`),
  createExperiment: () => api<ExperimentResponse>("/api/experiments", { method: "POST", body: "{}" }),
  sendTurn: (experimentId: string, message: string, arm: ModelArm, signal?: AbortSignal) =>
    api<TurnResponse>(`/api/experiments/${experimentId}/turns`, {
      method: "POST",
      body: JSON.stringify({ message, arms: [arm] }),
      signal,
    }),
  sendTurnStream: (
    experimentId: string,
    message: string,
    arms: ModelArm[],
    onEvent: (event: TurnStreamEvent) => void,
    signal?: AbortSignal,
  ) => fetch(`/api/experiments/${experimentId}/turns/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, arms }),
    signal,
  }).then((response) => readTurnEventStream(response, onEvent)),
  demoState: (experimentId: string, arm: ModelArm) =>
    api<PublicCounselState>(`/api/experiments/${experimentId}/demo-state?arm=${arm}`),
};
