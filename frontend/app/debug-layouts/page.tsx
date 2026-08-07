"use client";

import { useEffect, useRef, useState } from "react";
import { ensureKeepsakeAssetsReady, getLayout, renderKeepsakeLetter } from "@/lib/keepsake/renderer";
import type { KeepsakeLetter } from "@/types/counseling";

const CREATED_AT = "2026-01-01T00:00:00.000Z";

type Sample = Pick<
  KeepsakeLetter,
  "phrase_id" | "phrase_text" | "hashtags" | "template_id" | "orientation" | "recipient_modifier"
>;

// Mirrors PHRASE_CATALOG in backend/app/keepsakes.py, so the preview shows the
// same phrase that is already printed on each artwork.
const SAMPLES: Sample[] = [
  {
    phrase_id: "self_growth",
    recipient_modifier: "마음을 단단히 키워온",
    phrase_text: "지나온 마음을 잊지 마.",
    hashtags: ["자기다정함", "마음의성장", "있는그대로"],
    template_id: "featurephone_v1",
    orientation: "portrait",
  },
  {
    phrase_id: "steady_effort",
    recipient_modifier: "묵묵히 애써온",
    phrase_text: "세상일이 늘 쉽게 풀리진 않아도",
    hashtags: ["꾸준한마음", "노력의시간", "좋은열매"],
    template_id: "buddybuddy_v1",
    orientation: "portrait",
  },
  {
    phrase_id: "own_pace",
    recipient_modifier: "소원을 품고 걸어가는",
    phrase_text: "밤하늘의 별처럼",
    hashtags: ["나만의속도", "빛나는소원", "한걸음씩"],
    template_id: "pink_doodle_v1",
    orientation: "landscape",
  },
  {
    phrase_id: "joyful_release",
    recipient_modifier: "마음의 여유를 찾아가는",
    phrase_text: "열심히 사는 모습도 멋지지만",
    hashtags: ["마음의여유", "스트레스안녕", "오늘도토닥토닥"],
    template_id: "yellow_doodle_v1",
    orientation: "landscape",
  },
];

function toLetter(sample: Sample, nickname: string): KeepsakeLetter {
  return {
    id: `debug_${sample.template_id}`,
    recipient_name: nickname,
    recipient_modifier: sample.recipient_modifier,
    recipient_label: `${nickname}에게`,
    sender_name: "프바오",
    sender_label: "프바오",
    phrase_id: sample.phrase_id,
    phrase_text: sample.phrase_text,
    hashtags: sample.hashtags,
    template_id: sample.template_id,
    template_version: 1,
    orientation: sample.orientation,
    created_at: CREATED_AT,
    expires_at: CREATED_AT,
  };
}

function CanvasPreview({ letter }: { letter: KeepsakeLetter }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layout = getLayout(letter.template_id);

  useEffect(() => {
    let active = true;
    if (!canvasRef.current) return;
    void ensureKeepsakeAssetsReady(letter).then(() => {
      if (!active || !canvasRef.current) return;
      const context = canvasRef.current.getContext("2d");
      if (context) renderKeepsakeLetter(context, letter);
    });
    return () => {
      active = false;
    };
  }, [letter]);

  const isLandscape = layout.width > layout.height;

  return (
    <div
      style={{
        padding: 16,
        background: "#f0f0f0",
        borderRadius: 12,
        display: "inline-block",
      }}
    >
      <h2 style={{ marginBottom: 12, color: "#333", fontSize: "0.95rem", fontWeight: 700 }}>
        {letter.template_id}
        <span style={{ color: "#777", fontWeight: 400 }}>
          {" "}
          · {layout.width}×{layout.height}
        </span>
      </h2>
      <canvas
        ref={canvasRef}
        width={layout.width}
        height={layout.height}
        style={{
          width: isLandscape ? 480 : 320,
          height: "auto",
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
        }}
      />
    </div>
  );
}

export default function DebugLayoutsPage() {
  const [nickname, setNickname] = useState("여울");

  return (
    <main
      style={{
        padding: 40,
        fontFamily: "sans-serif",
        background: "#fff",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: "2rem", marginBottom: 12, color: "#111" }}>기념 편지 레이아웃 디버그</h1>
      <p style={{ marginBottom: 20, color: "#555" }}>
        배경·본문·From.은 PNG에 인쇄돼 있고, 캔버스가 그리는 건 <code>To.</code>와 <code>p.s</code> 두 줄뿐입니다.
        닉네임을 길게 바꿔서 줄어드는지 확인해 보세요.
      </p>
      <label style={{ display: "block", marginBottom: 32, color: "#333" }}>
        닉네임{" "}
        <input
          value={nickname}
          maxLength={10}
          onChange={(event) => setNickname(event.target.value)}
          style={{ padding: "6px 10px", fontSize: "1rem", border: "1px solid #bbb", borderRadius: 6 }}
        />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
        {SAMPLES.map((sample) => (
          <CanvasPreview
            key={sample.template_id}
            letter={toLetter(sample, nickname.trim() || "여울")}
          />
        ))}
      </div>
    </main>
  );
}
