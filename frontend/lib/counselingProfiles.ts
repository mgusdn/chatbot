import type { HealthResponse, ModelArm } from "@/types/counseling";

export type CounselingArmLabel = {
  badge: string;
  option: string;
  short: string;
  send: string;
};

export type CounselingArmLabels = Record<ModelArm, CounselingArmLabel>;

export function hasSeparateAnalyzerApi(health?: HealthResponse | null) {
  return health?.providers?.gemini?.profiles?.optimized?.analyzer_api_separate === true;
}

export function getCounselingArmLabels(health?: HealthResponse | null): CounselingArmLabels {
  const analyzerRoute = hasSeparateAnalyzerApi(health) ? "분리" : "공유";
  const baselineParallel = health?.providers?.gemini?.profiles?.baseline?.analyzer_api_route === "analyzer";

  return {
    baseline: {
      badge: "A · 말하며 판단",
      option: baselineParallel ? "공감·판단 병렬 (분리 API)" : "공감 먼저 → 이어서 판단",
      short: baselineParallel
        ? "Gemini · 공감 minimal · 판단 low · 분리 병렬"
        : "Gemini · 공감 minimal → 판단 low",
      send: "말하며 판단하는 A 흐름으로 보내기",
    },
    optimized: {
      badge: `B · 판단 API ${analyzerRoute}`,
      option: "개선 Gemini · minimal",
      short: `개선 Gemini · minimal · 판단 API ${analyzerRoute}`,
      send: "minimal 흐름으로 보내기",
    },
  };
}
