import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  friendlyCounselingError,
  hasSubstantiveText,
  isNormalCounselCompletion,
  withoutLatestTranscriptEntry,
} from "@/hooks/useCounselingSession";
import { readTurnEventStream } from "@/lib/api/counselingClient";
import { getCounselingArmLabels, hasSeparateAnalyzerApi } from "@/lib/counselingProfiles";
import type { HealthResponse } from "@/types/counseling";

describe("counseling response guards", () => {
  it("rejects empty and punctuation-only responses", () => {
    expect(hasSubstantiveText("..." )).toBe(false);
    expect(hasSubstantiveText("괜찮아요")).toBe(true);
  });

  it("maps provider failures to safe Korean guidance", () => {
    expect(friendlyCounselingError(new Error("429 prepayment credits"))).toContain("크레딧");
    expect(friendlyCounselingError(new Error("connection refused"))).toContain("Gemini");
    expect(friendlyCounselingError(new Error("마음연구소 서버에 연결할 수 없습니다."))).toContain("FastAPI");
    expect(friendlyCounselingError(new Error("응답 시간이 초과되었습니다."))).toContain("응답이 늦어");
    expect(friendlyCounselingError(new Error("404 세션을 찾을 수 없습니다"))).toContain("만료");
  });

  it("auto-completes only a non-safety done response with a report", () => {
    const done = { status: "ok", message: "## 마음 정리\n\n정리 내용", state: { stage: "done" } } as const;
    expect(isNormalCounselCompletion({ ...done, safety_bypass: false } as never)).toBe(true);
    expect(isNormalCounselCompletion({ ...done, safety_bypass: true } as never)).toBe(false);
    expect(isNormalCounselCompletion({ ...done } as never)).toBe(false);
    expect(isNormalCounselCompletion({ ...done, message: "...", safety_bypass: false } as never)).toBe(false);
  });

  it("rolls back only the latest optimistic user transcript entry", () => {
    const transcript = [
      { role: "user" as const, text: "같은 말" },
      { role: "bot" as const, text: "먼저 받은 답변" },
      { role: "user" as const, text: "같은 말" },
    ];

    expect(withoutLatestTranscriptEntry(transcript, { role: "user", text: "같은 말" })).toEqual([
      { role: "user", text: "같은 말" },
      { role: "bot", text: "먼저 받은 답변" },
    ]);
  });
});

describe("counseling experiment profile labels", () => {
  it("uses the safe shared-API label when an older health response has no profiles", () => {
    const labels = getCounselingArmLabels({ status: "ok", providers: { gemini: {} } });

    expect(labels.baseline.short).toBe("Gemini · 공감 minimal → 판단 low");
    expect(labels.optimized.short).toBe("개선 Gemini · minimal · 판단 API 공유");
    expect(hasSeparateAnalyzerApi(null)).toBe(false);
  });

  it("shows API separation only when health explicitly confirms it", () => {
    const health: HealthResponse = {
      status: "ok",
      providers: {
        gemini: {
          profiles: {
            baseline: { api_route: "primary", thinking_level: "low" },
            optimized: {
              response_api_route: "primary",
              response_thinking_level: "minimal",
              analyzer_api_route: "analyzer",
              analyzer_thinking_level: "low",
              analyzer_api_separate: true,
            },
          },
        },
      },
    };

    expect(hasSeparateAnalyzerApi(health)).toBe(true);
    expect(getCounselingArmLabels(health).optimized.short).toBe("개선 Gemini · minimal · 판단 API 분리");
  });
});

describe("counseling segmented stream", () => {
  it("decodes Korean NDJSON split across arbitrary byte boundaries", async () => {
    const payload = [
      JSON.stringify({
        type: "segment",
        turn_id: "run-1",
        comparison_id: "compare-1",
        arm: "baseline",
        sequence: 1,
        segment: "reflection",
        text: "바로 정리되지 않아도 괜찮아요.",
        elapsed_ms: 810,
      }),
      JSON.stringify({
        type: "segment",
        turn_id: "run-1",
        comparison_id: "compare-1",
        arm: "baseline",
        sequence: 2,
        segment: "aside",
        text: "첫걸음이 유난히 무거울 때가 있지요.",
        elapsed_ms: 1120,
      }),
      JSON.stringify({
        type: "complete",
        experiment_id: "experiment-1",
        comparison_id: "compare-1",
        results: { baseline: { status: "ok", message: "최종 질문입니다." } },
      }),
      "",
    ].join("\n");
    const bytes = new TextEncoder().encode(payload);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        [7, 19, 31, 58, bytes.length].reduce((start, end) => {
          controller.enqueue(bytes.slice(start, end));
          return end;
        }, 0);
        controller.close();
      },
    });
    const events: string[] = [];
    const result = await readTurnEventStream(
      new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" } }),
      (event) => events.push(event.type),
    );

    expect(events).toEqual(["segment", "segment", "complete"]);
    expect(result.results.baseline?.message).toBe("최종 질문입니다.");
  });

  it("keeps reflection visible through aside and replaces it with the canonical final text", () => {
    const staticSources = [
      {
        name: "A/B comparison",
        source: readFileSync(
          path.resolve(process.cwd(), "../backend/app/static/app.js"),
          "utf8",
        ),
        marker: "bubble.textContent = event.segment",
        currentText: (text: string) => ({ textContent: text }),
        finalMarker: 'streamed.querySelector(".bubble").textContent = result.message',
      },
      {
        name: "forest demo",
        source: readFileSync(
          path.resolve(process.cwd(), "../backend/app/static/demo/demo.js"),
          "utf8",
        ),
        marker: "streamedText = event.segment",
        currentText: (_text: string) => ({ textContent: "" }),
        finalMarker: "setResponse(result.message)",
      },
    ];

    for (const fixture of staticSources) {
      const expressionStart = fixture.source.indexOf(fixture.marker);
      expect(expressionStart, `${fixture.name} stream reducer`).toBeGreaterThan(-1);
      const valueStart = fixture.source.indexOf("=", expressionStart) + 1;
      const valueEnd = fixture.source.indexOf(";", valueStart);
      const expression = fixture.source.slice(valueStart, valueEnd).trim();
      const reduce = new Function(
        "event",
        "streamedText",
        "bubble",
        `return (${expression});`,
      ) as (
        event: { segment: "reflection" | "aside"; text: string },
        streamedText: string,
        bubble: { textContent: string },
      ) => string;

      let displayed = reduce(
        { segment: "reflection", text: "마음이 많이 답답하셨겠어요." },
        "",
        fixture.currentText(""),
      );
      displayed = reduce(
        { segment: "aside", text: "그럴 때가 있지요." },
        displayed,
        fixture.currentText(displayed),
      );

      expect(displayed, fixture.name).toBe(
        "마음이 많이 답답하셨겠어요. 그럴 때가 있지요.",
      );
      expect(fixture.source, `${fixture.name} final replacement`).toContain(
        fixture.finalMarker,
      );
    }
  });
});
