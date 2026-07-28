"use client";

import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect } from "react";
import styles from "./onboarding/EntryScreen.module.css";

const LandingForestCanvas = dynamic(() => import("./onboarding/LandingForestCanvas"), {
  ssr: false,
  loading: () => <div className={styles.canvasFallback} aria-hidden="true" />,
});

export function EntryScreen({ onStart }: { onStart: () => void }) {
  const reducedMotion = useReducedMotion();
  const topTitle = ["풀", "어", "봐", "요"] as const;
  const bottomTitle = ["고", "민", "의", "숲"] as const;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, textarea, select")) return;
      event.preventDefault();
      onStart();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onStart]);

  return (
    <main className={styles.screen} data-testid="entry-screen">
      <div className={styles.scene} aria-hidden="true">
        <LandingForestCanvas reducedMotion={Boolean(reducedMotion)} />
      </div>

      <div className={styles.haze} aria-hidden="true" />
      <motion.header
        className={styles.titleBlock}
        initial={{ opacity: 0, y: -18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.9, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1 aria-label="풀어봐요, 프바오와 고민의 숲.">
          <span className={styles.titleTop} aria-hidden="true">
            {topTitle.map((letter, index) => (
              <span key={letter} className={`${styles.titleGlyph} ${styles[`topGlyph${index + 1}`]}`}>
                {letter}
              </span>
            ))}
          </span>
          <span className={styles.titleRibbon} aria-hidden="true">프바오와</span>
          <span className={styles.titleBottom} aria-hidden="true">
            {bottomTitle.map((letter, index) => (
              <span key={letter} className={`${styles.titleGlyph} ${styles[`bottomGlyph${index + 1}`]}`}>
                {letter}
              </span>
            ))}
          </span>
        </h1>
      </motion.header>

      <motion.div
        className={styles.startArea}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reducedMotion ? 0 : 0.55, duration: reducedMotion ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <button type="button" className={styles.startButton} onClick={onStart} data-testid="start-button">
          <kbd aria-hidden="true">↵</kbd>
          <span>숲으로 들어가기</span>
        </button>
      </motion.div>

      <span className={styles.cornerMark} aria-hidden="true">PUMÉ FOREST</span>
    </main>
  );
}
