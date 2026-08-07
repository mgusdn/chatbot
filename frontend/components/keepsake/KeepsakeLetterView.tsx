"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { counselingApi } from "@/lib/api/counselingClient";
import {
  ensureKeepsakeAssetsReady,
  getLayout,
  renderKeepsakeLetter,
} from "@/lib/keepsake/renderer";
import type { KeepsakeLetter } from "@/types/counseling";
import styles from "./KeepsakeLetterView.module.css";

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("이미지를 만들지 못했어요.")), "image/png", 1);
  });
}

export function KeepsakeLetterView({ shareToken }: { shareToken: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [letter, setLetter] = useState<KeepsakeLetter | null>(null);
  const [status, setStatus] = useState("기념 편지를 펼치고 있어요…");
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let active = true;
    void counselingApi.getKeepsake(shareToken)
      .then(({ letter: nextLetter }) => {
        if (!active) return;
        setLetter(nextLetter);
        setStatus("편지가 도착했어요. 사진으로 저장해 주세요.");
      })
      .catch(() => {
        if (!active) return;
        setError("편지 링크가 만료되었거나 편지를 찾을 수 없어요.");
      });
    return () => { active = false; };
  }, [shareToken]);

  useEffect(() => {
    if (!letter || !canvasRef.current) return;
    let active = true;
    void ensureKeepsakeAssetsReady(letter).then(() => {
      if (!active || !canvasRef.current) return;
      const context = canvasRef.current.getContext("2d");
      if (context) renderKeepsakeLetter(context, letter);
    });
    return () => { active = false; };
  }, [letter]);

  const download = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !letter) return;
    setSharing(true);
    try {
      const blob = await canvasBlob(canvas);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${letter.recipient_name}-푸바오-기념편지.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("사진을 저장했어요. Xiaomi Home에서 사진 인쇄를 선택해 주세요.");
    } catch {
      setStatus("저장하지 못했어요. 편지 이미지를 길게 눌러 사진에 저장해 주세요.");
    } finally {
      setSharing(false);
    }
  }, [letter]);

  const share = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !letter || !navigator.share) return;
    setSharing(true);
    try {
      const blob = await canvasBlob(canvas);
      const file = new File([blob], `${letter.recipient_name}-푸바오-기념편지.png`, { type: "image/png" });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        await download();
        return;
      }
      await navigator.share({ files: [file], title: "푸바오 기념 편지" });
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setStatus("공유하지 못했어요. 먼저 사진으로 저장해 주세요.");
      }
    } finally {
      setSharing(false);
    }
  }, [download, letter]);

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="keepsake-title">
        <header className={styles.header}>
          <span>PBAO&apos;S KEEPSAKE LETTER</span>
          <h1 id="keepsake-title">오늘의 마음을 가져가세요</h1>
          <p>{error || status}</p>
        </header>

        {error ? (
          <div className={styles.error} role="alert">
            <strong>편지를 열지 못했어요</strong>
            <p>{error}</p>
          </div>
        ) : letter ? (
          <>
            <div className={styles.preview}>
              <canvas
                ref={canvasRef}
                width={getLayout(letter.template_id).width}
                height={getLayout(letter.template_id).height}
                aria-label={`${letter.recipient_name}님의 푸바오 기념 편지`}
              />
            </div>
            <div className={styles.actions}>
              <button type="button" onClick={download} disabled={sharing}>사진으로 저장</button>
              {typeof navigator !== "undefined" && "share" in navigator ? (
                <button type="button" className={styles.secondary} onClick={share} disabled={sharing}>
                  공유해서 인쇄하기
                </button>
              ) : null}
            </div>
            <ol className={styles.guide}>
              <li>편지를 사진으로 저장합니다.</li>
              <li>Xiaomi Home 앱에서 포토 프린터를 엽니다.</li>
              <li>사진 인쇄에서 저장한 편지를 선택합니다.</li>
            </ol>
          </>
        ) : (
          <div className={styles.loading} aria-live="polite"><span /><span /><span /></div>
        )}
      </section>
    </main>
  );
}
