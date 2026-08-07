export type SpeechHealth = {
  status: string;
  stt: {
    available: boolean;
    model?: string;
    loaded?: boolean;
    language?: string;
    reason?: string | null;
    warm_error?: string | null;
  };
  tts: {
    configured: boolean;
    connected?: boolean | null;
    reason?: string | null;
  };
};

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<T>;
}

export const speechApi = {
  health: (probe = true, warm = true) => fetch(`/api/speech/health?probe=${probe}&warm=${warm}`, {
    cache: "no-store",
  }).then((response) => json<SpeechHealth>(response)),

  transcribe: (audio: Blob, signal?: AbortSignal) => fetch("/api/speech/transcriptions", {
    method: "POST",
    headers: { "Content-Type": audio.type || "application/octet-stream" },
    body: audio,
    signal,
  }).then((response) => json<{ text: string; stt_ms: number }>(response)),

  createSynthesis: (
    text: string,
    ids: { turnId?: string; segmentId?: string; padEnd?: boolean },
    signal?: AbortSignal,
  ) => fetch("/api/speech/synthesis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      turn_id: ids.turnId,
      segment_id: ids.segmentId,
      pad_end: ids.padEnd,
    }),
    signal,
  }).then((response) => json<{
    ticket_id: string;
    audio_url: string;
    expires_in_seconds: number;
  }>(response)),
};
