export type ModelArm = "baseline" | "optimized";
export type PandaStageState = "booting" | "idle" | "thinking" | "talking" | "error";

export type ProviderStatus = {
  configured?: boolean;
  connected?: boolean | null;
  model?: string;
  resolved_model?: string;
  profiles?: GeminiExperimentProfiles;
};

export type BaselineGeminiProfile = {
  api_route?: "primary";
  /** Legacy health payload before the response/analyzer split. */
  thinking_level?: "low" | string;
  response_thinking_level?: "minimal" | string;
  analyzer_thinking_level?: "low" | string;
  analyzer_api_route?: "primary" | "analyzer" | string;
  loop_profile?: "principle_cache_speaking_v5" | string;
  delivery_profile?: "dynamic_principle_aside_v4" | string;
  opening_lead_timeout_ms?: number;
  bridge_delay_ms?: number;
  aside_cooldown_turns?: number;
};

export type OptimizedGeminiProfile = {
  response_api_route?: "primary" | string;
  response_thinking_level?: "minimal" | string;
  analyzer_api_route?: "primary" | "analyzer" | string;
  analyzer_thinking_level?: "low" | string;
  analyzer_api_separate?: boolean;
};

export type GeminiExperimentProfiles = {
  baseline?: BaselineGeminiProfile;
  optimized?: OptimizedGeminiProfile;
};

export type HealthResponse = {
  status: string;
  providers?: { gemini?: ProviderStatus };
  limitations?: { stt?: string; tts?: string };
};

export type PublicCounselState = {
  stage: "rapport" | "loop" | "values" | "done";
  rapport_step?: "greeting" | "mood" | "how" | "who";
  turn_count: number;
  filled_slots: string[];
  pending_slot?: string | null;
  slot_values?: Record<string, string[]>;
  report_fallback?: boolean;
};

export type ExperimentResponse = {
  experiment_id: string;
  created_at: string;
  greetings: Record<ModelArm, string>;
  states: Record<ModelArm, PublicCounselState>;
};

export type TurnResult = {
  run_id?: string;
  status: "ok" | "error";
  message?: string | null;
  error?: string | null;
  safety_bypass?: boolean;
  state?: PublicCounselState;
  metrics?: {
    total_ms?: number;
    model_ms?: number;
    model_calls?: number;
    first_response_ms?: number | null;
    reflection_ready_ms?: number | null;
    aside_ready_ms?: number | null;
    bridge_ready_ms?: number | null;
    aside_emitted?: boolean;
    bridge_emitted?: boolean;
    delivery_profile?: string;
  };
};

export type TurnResponse = {
  experiment_id: string;
  comparison_id: string;
  results: Partial<Record<ModelArm, TurnResult>>;
};

export type TurnStreamSegmentEvent = {
  type: "segment";
  turn_id: string;
  comparison_id: string;
  arm: "baseline";
  sequence: number;
  segment: "reflection" | "aside" | "bridge";
  text: string;
  elapsed_ms: number;
};

export type TurnStreamArmResultEvent = {
  type: "arm_result";
  turn_id: string;
  comparison_id: string;
  arm: ModelArm;
  sequence: number;
  result: TurnResult;
  speech_continuation?: string | null;
};

export type TurnStreamCompleteEvent = TurnResponse & { type: "complete" };

export type TurnStreamEvent =
  | TurnStreamSegmentEvent
  | TurnStreamArmResultEvent
  | TurnStreamCompleteEvent;

export type TranscriptEntry = { role: "user" | "bot"; text: string };

export type CounselReport = {
  id: string;
  experimentId: string;
  arm: ModelArm;
  createdAt: string;
  markdown: string;
  reportFallback: boolean;
  state: PublicCounselState;
};

export type CounselingSendOutcome =
  | { accepted: false; kind: "rejected" | "error" }
  | { accepted: true; kind: "continue" | "safety" }
  | { accepted: true; kind: "complete"; report: CounselReport };
