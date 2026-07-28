"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  resolveSelectableCharacterId,
  SELECTABLE_CHARACTER_CATALOG,
} from "@/constants/characterCatalog";
import { normalizeNickname, readPlayerProfile, validateNickname } from "@/lib/storage/playerProfile";
import { useGameStore } from "@/store/useGameStore";
import type { CharacterDefinition } from "@/types/character";
import styles from "./onboarding/CharacterSelectScreen.module.css";

const CharacterPreviewCanvas = dynamic(() => import("./onboarding/CharacterPreviewCanvas"), {
  ssr: false,
  loading: () => <div className={styles.previewLoading}><span /></div>,
});

type Props = {
  initialNickname?: string;
  onConfirm: (nickname: string) => void;
};

type PreviewFields = {
  kind?: "human" | "animal";
  previewColor?: string;
  previewImageUrl?: string | null;
};

function getPreviewFields(character: CharacterDefinition) {
  const preview = character as CharacterDefinition & PreviewFields;
  return {
    kind: preview.kind ?? "human",
    color: preview.previewColor ?? character.colors.top,
    imageUrl: preview.previewImageUrl ?? null,
  };
}

function residentTypeLabel(character: CharacterDefinition) {
  if (character.bodyFamily === "pet") return "작은 펫";
  if (character.bodyFamily === "biped-animal") return "동물 주민";
  if (character.bodyFamily === "mini-human") return "꼬마 주민";
  return "사람 주민";
}

function CharacterPortrait({ character }: { character: CharacterDefinition }) {
  const { kind, color, imageUrl } = getPreviewFields(character);

  return (
    <span
      className={styles.portrait}
      data-kind={kind}
      data-species={character.species}
      style={{
        "--portrait-color": color,
        "--portrait-hair": character.colors.hair,
        "--portrait-skin": character.colors.skin,
        "--portrait-accent": character.colors.accent,
      } as React.CSSProperties}
      aria-hidden="true"
    >
      {imageUrl ? (
        // Official pack previews are deliberately used as static thumbnails; only the selected resident gets a live Canvas.
        <img src={imageUrl} alt="" draggable={false} />
      ) : (
        <>
          <i className={styles.fallbackHead} />
          <b>{character.name.slice(0, 1)}</b>
        </>
      )}
    </span>
  );
}

export function CharacterSelectScreen({ initialNickname = "", onConfirm }: Props) {
  const selected = useGameStore((state) => state.selectedCharacterId);
  const select = useGameStore((state) => state.selectCharacter);
  const reducedMotion = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [nickname, setNickname] = useState(initialNickname);
  const [nicknameTouched, setNicknameTouched] = useState(false);

  useEffect(() => {
    if (initialNickname) {
      setNickname(initialNickname);
      return;
    }
    const storedNickname = readPlayerProfile(window.localStorage)?.nickname;
    if (storedNickname) setNickname(storedNickname);
  }, [initialNickname]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const normalizedNickname = useMemo(() => normalizeNickname(nickname), [nickname]);
  const nicknameError = useMemo(() => validateNickname(nickname), [nickname]);
  const resolvedSelection = resolveSelectableCharacterId(selected);
  const selectedCharacter = selected
    ? SELECTABLE_CHARACTER_CATALOG.find((character) => character.id === resolvedSelection) ?? null
    : null;
  const canConfirm = Boolean(selectedCharacter && !nicknameError);

  useEffect(() => {
    if (resolvedSelection && resolvedSelection !== selected) select(resolvedSelection);
  }, [resolvedSelection, select, selected]);

  const moveSelection = useCallback((direction: number) => {
    if (!SELECTABLE_CHARACTER_CATALOG.length) return;
    const current = Math.max(
      0,
      SELECTABLE_CHARACTER_CATALOG.findIndex((character) => character.id === resolvedSelection),
    );
    const next = (
      current + direction + SELECTABLE_CHARACTER_CATALOG.length
    ) % SELECTABLE_CHARACTER_CATALOG.length;
    select(SELECTABLE_CHARACTER_CATALOG[next].id);
  }, [resolvedSelection, select]);

  const submit = useCallback(() => {
    setNicknameTouched(true);
    if (!selectedCharacter || validateNickname(nickname)) return;
    onConfirm(normalizeNickname(nickname));
  }, [nickname, onConfirm, selectedCharacter]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = Boolean(target?.closest("input, textarea, select"));
      if (!isTyping && event.key === "ArrowLeft") {
        event.preventDefault();
        moveSelection(-1);
      }
      if (!isTyping && event.key === "ArrowRight") {
        event.preventDefault();
        moveSelection(1);
      }
      if (!isTyping && event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-3);
      }
      if (!isTyping && event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(3);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moveSelection]);

  return (
    <motion.section
      className={styles.overlay}
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reducedMotion ? undefined : { opacity: 0 }}
      aria-labelledby="characterSelectTitle"
      data-testid="character-select-screen"
    >
      <div className={styles.ambientOrb} aria-hidden="true" />
      <div className={styles.layout}>
        <form
          className={styles.controlPanel}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <header className={styles.heading}>
            <span>오늘의 주민 등록</span>
            <h1 id="characterSelectTitle">어떤 모습으로<br />숲을 걸어볼까요?</h1>
            <p>마음에 드는 주민과 불리고 싶은 이름을 골라주세요.</p>
          </header>

          <label className={styles.nicknameField} htmlFor="playerNickname">
            <span>
              <strong>닉네임을 입력해주세요</strong>
              <small>{Array.from(normalizedNickname).length}/10</small>
            </span>
            <span className={`${styles.inputShell} ${nicknameTouched && nicknameError ? styles.hasError : ""}`}>
              <input
                ref={inputRef}
                id="playerNickname"
                name="nickname"
                type="text"
                value={nickname}
                maxLength={20}
                autoComplete="nickname"
                placeholder="예: 마음산책자"
                aria-invalid={nicknameTouched && Boolean(nicknameError)}
                aria-describedby="nicknameHint"
                onChange={(event) => {
                  setNickname(event.target.value);
                  if (!nicknameTouched) setNicknameTouched(true);
                }}
                onBlur={() => setNicknameTouched(true)}
              />
              {normalizedNickname ? <i aria-hidden="true">✓</i> : null}
            </span>
            <small id="nicknameHint" className={styles.nicknameHint} aria-live="polite">
              {nicknameTouched && nicknameError ? nicknameError : "공백을 제외한 1~10자로 지어주세요."}
            </small>
          </label>

          <div className={styles.residentHeader}>
            <strong>함께할 주민</strong>
            <span>{SELECTABLE_CHARACTER_CATALOG.length}명의 친구</span>
          </div>

          <div className={styles.characterGrid} role="radiogroup" aria-label="플레이어 캐릭터 선택">
            {SELECTABLE_CHARACTER_CATALOG.map((character) => {
              const checked = selected === character.id;
              const { kind } = getPreviewFields(character);
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={`${character.name}, ${character.description}`}
                  className={`${styles.characterCard} ${checked ? styles.isSelected : ""}`}
                  key={character.id}
                  onClick={() => select(character.id)}
                  data-character-option={character.id}
                >
                  <CharacterPortrait character={character} />
                  <span className={styles.characterCopy}>
                    <strong>{character.name}</strong>
                    <small>{residentTypeLabel(character)}</small>
                  </span>
                  <i className={styles.selectionMark} aria-hidden="true">✓</i>
                </button>
              );
            })}
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.arrowButton} onClick={() => moveSelection(-1)} aria-label="이전 주민">←</button>
            <button type="submit" className={styles.confirmButton} disabled={!canConfirm} data-testid="confirm-character">
              <span>{selectedCharacter ? `${selectedCharacter.name}(으)로 시작` : "주민을 선택해주세요"}</span>
              <i aria-hidden="true">→</i>
            </button>
            <button type="button" className={styles.arrowButton} onClick={() => moveSelection(1)} aria-label="다음 주민">→</button>
          </div>
        </form>

        <aside className={styles.previewPanel} aria-label="선택한 주민 미리보기">
          <div className={styles.previewGrid} aria-hidden="true" />
          <AnimatePresence mode="wait">
            {selectedCharacter ? (
              <motion.div
                className={styles.previewCanvas}
                key={selectedCharacter.id}
                initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reducedMotion ? undefined : { opacity: 0, scale: 1.02 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <CharacterPreviewCanvas characterId={selectedCharacter.id} />
              </motion.div>
            ) : (
              <motion.div className={styles.emptyPreview} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <span aria-hidden="true">?</span>
                <strong>만나고 싶은 주민을<br />한 명 골라주세요</strong>
                <small>왼쪽 카드에서 선택할 수 있어요.</small>
              </motion.div>
            )}
          </AnimatePresence>

          <div className={styles.previewTopline}>
            <span>LIVE PREVIEW</span>
            <i aria-hidden="true" />
          </div>

          <motion.div
            className={styles.namePlate}
            key={`${selected ?? "empty"}-${normalizedNickname}`}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            aria-live="polite"
          >
            <span>{selectedCharacter?.name ?? "주민을 고르는 중"}</span>
            <strong>{normalizedNickname || "이름을 기다리고 있어요"}</strong>
            <small>{selectedCharacter ? `${selectedCharacter.description}` : "오늘의 숲 주민"}</small>
          </motion.div>

          <p className={styles.dragHint}><span aria-hidden="true">↔</span> 드래그해서 천천히 둘러보세요</p>
        </aside>
      </div>
    </motion.section>
  );
}
