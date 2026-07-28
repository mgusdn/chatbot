"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  GUESTBOOK_EDITOR_LIMITS,
  GUESTBOOK_MAX_LAYERS,
  GUESTBOOK_MAX_SIGNATURE_TEXT,
  GUESTBOOK_MAX_STICKER_LAYERS,
  GUESTBOOK_MAX_TEXT_LAYERS,
  GUESTBOOK_MAX_TOTAL_TEXT,
  clampGuestbookPosition,
  countGuestbookText,
  createGuestbookStickerLayer,
  createGuestbookTextLayer,
  ensureGuestbookSignatureFontReady,
  GUESTBOOK_TEMPLATE_OPTIONS,
  getGuestbookTemplate,
  getGuestbookLayerPixelRect,
  hitTestGuestbookLayer,
  normalizeGuestbookDesign,
  normalizeGuestbookRotation,
  normalizeGuestbookSignature,
  normalizeGuestbookText,
  renderGuestbookDesign,
  reorderGuestbookLayer,
  replaceGuestbookLayer,
} from "@/lib/guestbook";
import {
  GUESTBOOK_STICKER_IDS,
  GUESTBOOK_TEXT_ALIGNS,
  GUESTBOOK_TEXT_COLORS,
  GUESTBOOK_TEXT_FONTS,
  type GuestbookDesign,
  type GuestbookDesignLayerV1,
  type GuestbookDesignV2,
  type GuestbookStickerId,
  type GuestbookTextLayerV1,
} from "@/types/memoryRoom";
import styles from "./GuestbookLetterEditor.module.css";

const STICKER_LABELS: Record<GuestbookStickerId, string> = {
  heart: "하트",
  sparkle: "반짝이",
  leaf: "잎",
  flower: "꽃",
  star: "별",
  smile: "미소",
  speech: "말풍선",
  paw: "발자국",
  "thumbs-up": "좋아요",
  "prometheus-p": "프로메테우스 P",
};

const FONT_LABELS = { round: "둥근 글씨", display: "도톰한 글씨" } as const;
const COLOR_LABELS = { ink: "먹색", berry: "산딸기", ocean: "바다", sun: "햇살" } as const;
const ALIGN_LABELS = { left: "왼쪽", center: "가운데", right: "오른쪽" } as const;

type DragState = {
  layerId: string;
  offsetX: number;
  offsetY: number;
};

type TextCompositionDraft = {
  layerId: string;
  value: string;
};

export type GuestbookLetterEditorProps = {
  design: GuestbookDesign;
  onChange: (design: GuestbookDesign) => void;
  className?: string;
};

function trimCodepoints(value: string, maxLength: number) {
  return Array.from(value).slice(0, Math.max(0, maxLength)).join("");
}

function stickerLabel(stickerId: GuestbookStickerId) {
  return STICKER_LABELS[stickerId];
}

function stickerToolbarArtwork(stickerId: GuestbookStickerId) {
  if (stickerId === "prometheus-p") {
    return (
      <img
        src="/images/guestbook/prometheus-p.png"
        alt=""
        aria-hidden="true"
        width={24}
        height={24}
        draggable={false}
      />
    );
  }
  if (stickerId === "thumbs-up") return <span aria-hidden="true">👍</span>;
  return (
    <span aria-hidden="true">
      {stickerId === "heart" ? "♥" : stickerId === "star" ? "★" : "●"}
    </span>
  );
}

function layerLabel(layer: GuestbookDesignLayerV1, index: number) {
  if (layer.type === "sticker") return `${stickerLabel(layer.sticker_id)} 스티커`;
  const text = layer.text.trim();
  return text ? `글씨 ${index + 1}: ${trimCodepoints(text, 16)}` : `빈 글씨 ${index + 1}`;
}

export function GuestbookLetterEditor({ design, onChange, className }: GuestbookLetterEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [fontRevision, setFontRevision] = useState(0);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(design.layers[0]?.id || null);
  const selectedLayer = useMemo(
    () => design.layers.find((layer) => layer.id === selectedLayerId) || null,
    [design.layers, selectedLayerId],
  );
  const textCount = design.layers.filter((layer) => layer.type === "text").length;
  const stickerCount = design.layers.length - textCount;
  const signature = design.version === 2 ? design.signature || "" : "";
  const [signatureDraft, setSignatureDraft] = useState(signature);
  const signatureFocusedRef = useRef(false);
  const signatureComposingRef = useRef(false);
  const [textCompositionDraft, setTextCompositionDraft] = useState<TextCompositionDraft | null>(null);
  const layerTextTotal = design.layers.reduce(
    (total, layer) => total + (layer.type === "text" ? countGuestbookText(layer.text) : 0),
    0,
  );
  const totalPublicText = layerTextTotal + countGuestbookText(signatureDraft);
  const template = getGuestbookTemplate(design.template_id);

  const upgradeDesign = useCallback((
    patch: Partial<Pick<GuestbookDesignV2, "template_id" | "signature">>,
  ) => normalizeGuestbookDesign({
    version: 2,
    template_id: patch.template_id ?? design.template_id,
    layers: design.layers,
    signature: patch.signature !== undefined
      ? patch.signature
      : design.version === 2
        ? design.signature
        : null,
  }), [design]);

  useEffect(() => {
    let current = true;
    void ensureGuestbookSignatureFontReady().then(() => {
      if (current) setFontRevision((revision) => revision + 1);
    });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (selectedLayerId && design.layers.some((layer) => layer.id === selectedLayerId)) return;
    setSelectedLayerId(design.layers.at(-1)?.id || null);
  }, [design.layers, selectedLayerId]);

  useEffect(() => {
    if (!signatureFocusedRef.current && !signatureComposingRef.current) setSignatureDraft(signature);
  }, [signature]);

  useEffect(() => {
    if (textCompositionDraft && textCompositionDraft.layerId !== selectedLayerId) {
      setTextCompositionDraft(null);
    }
  }, [selectedLayerId, textCompositionDraft]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    renderGuestbookDesign(context, design, { width: canvas.width, height: canvas.height });
    if (!selectedLayer) return;
    const bounds = getGuestbookLayerPixelRect(context, selectedLayer, canvas.width, canvas.height);
    context.save();
    context.translate(bounds.centerX, bounds.centerY);
    context.rotate(bounds.rotationDeg * Math.PI / 180);
    context.strokeStyle = "#456c5b";
    context.lineWidth = 4;
    context.setLineDash([11, 7]);
    context.strokeRect(-bounds.width / 2 - 8, -bounds.height / 2 - 8, bounds.width + 16, bounds.height + 16);
    context.setLineDash([]);
    context.fillStyle = "#fffaf0";
    context.strokeStyle = "#456c5b";
    [
      [-bounds.width / 2 - 8, -bounds.height / 2 - 8],
      [bounds.width / 2 + 8, bounds.height / 2 + 8],
    ].forEach(([x, y]) => {
      context.beginPath();
      context.arc(x, y, 8, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    });
    context.restore();
  }, [design, fontRevision, selectedLayer]);

  const replaceSelected = useCallback((next: GuestbookDesignLayerV1) => {
    if (!selectedLayerId) return;
    onChange(replaceGuestbookLayer(design, selectedLayerId, next));
  }, [design, onChange, selectedLayerId]);

  const canvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
    };
  };

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event);
    const context = event.currentTarget.getContext("2d");
    if (!point || !context) return;
    const layerId = hitTestGuestbookLayer(
      context,
      design,
      point,
      event.currentTarget.width,
      event.currentTarget.height,
    );
    setSelectedLayerId(layerId);
    if (!layerId) {
      dragRef.current = null;
      return;
    }
    const layer = design.layers.find((item) => item.id === layerId);
    if (!layer) return;
    dragRef.current = {
      layerId,
      offsetX: point.x / event.currentTarget.width - layer.x,
      offsetY: point.y / event.currentTarget.height - layer.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const point = canvasPoint(event);
    if (!drag || !point) return;
    const layer = design.layers.find((item) => item.id === drag.layerId);
    if (!layer) return;
    onChange(replaceGuestbookLayer(design, layer.id, {
      ...layer,
      x: clampGuestbookPosition(point.x / event.currentTarget.width - drag.offsetX),
      y: clampGuestbookPosition(point.y / event.currentTarget.height - drag.offsetY),
    }));
    event.preventDefault();
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const addText = () => {
    if (textCount >= GUESTBOOK_MAX_TEXT_LAYERS || design.layers.length >= GUESTBOOK_MAX_LAYERS) return;
    const layer = createGuestbookTextLayer({
      x: 0.34 + (textCount % 3) * 0.16,
      y: 0.34 + (textCount % 2) * 0.25,
      rotation_deg: [-5, 3, -2, 5, 0, -4][textCount] || 0,
    });
    onChange(normalizeGuestbookDesign({ ...design, layers: [...design.layers, layer] }));
    setSelectedLayerId(layer.id);
  };

  const addSticker = (stickerId: GuestbookStickerId) => {
    if (stickerCount >= GUESTBOOK_MAX_STICKER_LAYERS || design.layers.length >= GUESTBOOK_MAX_LAYERS) return;
    const layer = createGuestbookStickerLayer(stickerId, {
      x: 0.2 + (stickerCount % 4) * 0.2,
      y: stickerCount % 2 ? 0.74 : 0.23,
      rotation_deg: [-12, 8, -5, 14][stickerCount % 4],
    });
    onChange(normalizeGuestbookDesign({ ...design, layers: [...design.layers, layer] }));
    setSelectedLayerId(layer.id);
  };

  const removeSelected = () => {
    if (!selectedLayerId) return;
    const index = design.layers.findIndex((layer) => layer.id === selectedLayerId);
    const layers = design.layers.filter((layer) => layer.id !== selectedLayerId);
    onChange(normalizeGuestbookDesign({ ...design, layers }));
    setSelectedLayerId(layers[Math.min(index, layers.length - 1)]?.id || null);
  };

  const moveSelected = (edge: "front" | "back") => {
    if (!selectedLayerId) return;
    onChange(reorderGuestbookLayer(design, selectedLayerId, edge));
  };

  const keyboardMove = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, button") || !selectedLayer) return;
    const amount = event.shiftKey ? 0.025 : 0.006;
    const movement: Record<string, readonly [number, number]> = {
      ArrowLeft: [-amount, 0],
      ArrowRight: [amount, 0],
      ArrowUp: [0, -amount],
      ArrowDown: [0, amount],
    };
    if (event.key in movement) {
      const [dx, dy] = movement[event.key];
      replaceSelected({
        ...selectedLayer,
        x: clampGuestbookPosition(selectedLayer.x + dx),
        y: clampGuestbookPosition(selectedLayer.y + dy),
      });
      event.preventDefault();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      removeSelected();
      event.preventDefault();
    } else if (event.key === "[" || event.key === "]") {
      replaceSelected({
        ...selectedLayer,
        rotation_deg: normalizeGuestbookRotation(selectedLayer.rotation_deg + (event.key === "[" ? -2 : 2)),
      });
      event.preventDefault();
    }
  };

  const updateText = (layer: GuestbookTextLayerV1, value: string) => {
    const otherTextLength = design.layers.reduce(
      (total, item) => total + (item.type === "text" && item.id !== layer.id ? countGuestbookText(item.text) : 0),
      0,
    );
    const signatureLength = design.version === 2 && design.signature
      ? countGuestbookText(design.signature)
      : 0;
    replaceSelected({
      ...layer,
      text: trimCodepoints(
        value,
        GUESTBOOK_MAX_TOTAL_TEXT - otherTextLength - signatureLength,
      ),
    });
  };

  const limitedSignatureValue = (value: string) => {
    const sanitized = normalizeGuestbookText(value).replace(/\n/g, " ");
    return trimCodepoints(
      sanitized,
      Math.min(GUESTBOOK_MAX_SIGNATURE_TEXT, GUESTBOOK_MAX_TOTAL_TEXT - layerTextTotal),
    );
  };

  const updateSignature = (value: string) => {
    const limited = limitedSignatureValue(value);
    setSignatureDraft(limited);
    onChange(upgradeDesign({ signature: normalizeGuestbookSignature(limited) }));
  };

  return (
    <div
      className={`${styles.editor}${className ? ` ${className}` : ""}`}
      onKeyDown={keyboardMove}
      data-testid="guestbook-letter-editor"
    >
      <div className={styles.workspace}>
        <fieldset className={styles.templatePicker}>
          <legend>편지지</legend>
          <div role="radiogroup" aria-label="편지지 선택">
            {GUESTBOOK_TEMPLATE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={design.template_id === option.id}
                tabIndex={design.template_id === option.id ? 0 : -1}
                aria-label={`${option.label}: ${option.description}`}
                className={styles.templateOption}
                style={{
                  "--paper-start": option.backgroundStart,
                  "--paper-end": option.backgroundEnd,
                  "--paper-border": option.borderColor,
                  "--paper-pattern": option.patternColor,
                } as CSSProperties}
                data-pattern={option.pattern}
                onClick={() => onChange(upgradeDesign({ template_id: option.id }))}
                onKeyDown={(event) => {
                  const currentIndex = GUESTBOOK_TEMPLATE_OPTIONS.findIndex(
                    (candidate) => candidate.id === option.id,
                  );
                  let nextIndex: number | null = null;
                  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                    nextIndex = (currentIndex + 1) % GUESTBOOK_TEMPLATE_OPTIONS.length;
                  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                    nextIndex = (
                      currentIndex - 1 + GUESTBOOK_TEMPLATE_OPTIONS.length
                    ) % GUESTBOOK_TEMPLATE_OPTIONS.length;
                  } else if (event.key === "Home") {
                    nextIndex = 0;
                  } else if (event.key === "End") {
                    nextIndex = GUESTBOOK_TEMPLATE_OPTIONS.length - 1;
                  }
                  if (nextIndex === null) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const next = GUESTBOOK_TEMPLATE_OPTIONS[nextIndex];
                  const buttons = event.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
                  buttons?.[nextIndex]?.focus();
                  onChange(upgradeDesign({ template_id: next.id }));
                }}
              >
                <span className={styles.templateSwatch} aria-hidden="true" />
                <span><strong>{option.label}</strong><small>{option.description}</small></span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className={styles.toolbar} aria-label="방명록 요소 추가">
          <button
            type="button"
            className={styles.addText}
            onClick={addText}
            disabled={textCount >= GUESTBOOK_MAX_TEXT_LAYERS || design.layers.length >= GUESTBOOK_MAX_LAYERS}
          >
            + 글씨
          </button>
          <div className={styles.stickers}>
            {GUESTBOOK_STICKER_IDS.map((stickerId) => (
              <button
                key={stickerId}
                type="button"
                data-sticker={stickerId}
                aria-label={`${stickerLabel(stickerId)} 스티커 추가`}
                title={`${stickerLabel(stickerId)} 스티커`}
                onClick={() => addSticker(stickerId)}
                disabled={stickerCount >= GUESTBOOK_MAX_STICKER_LAYERS || design.layers.length >= GUESTBOOK_MAX_LAYERS}
              >
                {stickerToolbarArtwork(stickerId)}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.canvasFrame}>
          <canvas
            ref={canvasRef}
            width={1024}
            height={640}
            className={styles.canvas}
            aria-label={`${template.label} 방명록 디자인 편집 영역`}
            tabIndex={0}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </div>
        <p className={styles.canvasHelp}>요소를 끌어 옮기고, 선택한 요소는 오른쪽 설정에서 크기와 각도를 바꿀 수 있어요.</p>
      </div>

      <aside className={styles.inspector} aria-label="선택 요소 설정">
        <div className={styles.layerHeader}>
          <strong>레이어</strong>
          <span>{design.layers.length}/{GUESTBOOK_MAX_LAYERS}</span>
        </div>
        <ol className={styles.layerList}>
          {[...design.layers].reverse().map((layer, reverseIndex) => {
            const index = design.layers.length - reverseIndex - 1;
            return (
              <li key={layer.id}>
                <button
                  type="button"
                  aria-pressed={selectedLayerId === layer.id}
                  onClick={() => setSelectedLayerId(layer.id)}
                >
                  <span>{layer.type === "text" ? "T" : "◆"}</span>
                  {layerLabel(layer, index)}
                </button>
              </li>
            );
          })}
        </ol>

        <label className={styles.signatureControl}>
          <span>서명 <small>선택</small></span>
          <input
            type="text"
            value={signatureDraft}
            placeholder="다정한 산책자"
            aria-describedby="guestbook-signature-help guestbook-signature-count"
            onFocus={() => { signatureFocusedRef.current = true; }}
            onCompositionStart={() => { signatureComposingRef.current = true; }}
            onCompositionEnd={(event) => {
              signatureComposingRef.current = false;
              updateSignature(event.currentTarget.value);
            }}
            onChange={(event) => {
              if (
                signatureComposingRef.current
                || (event.nativeEvent as InputEvent).isComposing
              ) {
                // NFKC turns an in-progress compatibility jamo such as ㄴ
                // into ᄂ, which breaks Korean IME composition. Preserve the
                // browser-owned string verbatim until compositionend.
                setSignatureDraft(event.currentTarget.value);
                return;
              }
              updateSignature(event.currentTarget.value);
            }}
            onBlur={(event) => {
              signatureFocusedRef.current = false;
              signatureComposingRef.current = false;
              const committed = normalizeGuestbookSignature(
                limitedSignatureValue(event.currentTarget.value),
              );
              setSignatureDraft(committed || "");
              onChange(upgradeDesign({ signature: committed }));
            }}
          />
          <span className={styles.signatureHelp}>
            <small id="guestbook-signature-help">편지 오른쪽 아래에 손글씨로 들어가요.</small>
            <output id="guestbook-signature-count">{countGuestbookText(signatureDraft)}/{GUESTBOOK_MAX_SIGNATURE_TEXT}</output>
          </span>
        </label>

        {selectedLayer ? (
          <div className={styles.controls}>
            {selectedLayer.type === "text" ? (
              <>
                <label>
                  문구
                  <textarea
                    rows={3}
                    value={
                      textCompositionDraft?.layerId === selectedLayer.id
                        ? textCompositionDraft.value
                        : selectedLayer.text
                    }
                    placeholder="마음을 적어주세요."
                    onCompositionStart={(event) => {
                      setTextCompositionDraft({
                        layerId: selectedLayer.id,
                        value: event.currentTarget.value,
                      });
                    }}
                    onCompositionEnd={(event) => {
                      setTextCompositionDraft(null);
                      updateText(selectedLayer, event.currentTarget.value);
                    }}
                    onChange={(event) => {
                      if (
                        textCompositionDraft?.layerId === selectedLayer.id
                        || (event.nativeEvent as InputEvent).isComposing
                      ) {
                        setTextCompositionDraft({
                          layerId: selectedLayer.id,
                          value: event.currentTarget.value,
                        });
                        return;
                      }
                      updateText(selectedLayer, event.currentTarget.value);
                    }}
                    onBlur={(event) => {
                      if (textCompositionDraft?.layerId !== selectedLayer.id) return;
                      setTextCompositionDraft(null);
                      updateText(selectedLayer, event.currentTarget.value);
                    }}
                  />
                </label>
                <div className={styles.controlGrid}>
                  <label>
                    글씨체
                    <select
                      value={selectedLayer.font}
                      onChange={(event) => replaceSelected({
                        ...selectedLayer,
                        font: event.target.value as GuestbookTextLayerV1["font"],
                      })}
                    >
                      {GUESTBOOK_TEXT_FONTS.map((font) => <option key={font} value={font}>{FONT_LABELS[font]}</option>)}
                    </select>
                  </label>
                  <label>
                    글씨 색
                    <select
                      value={selectedLayer.color}
                      onChange={(event) => replaceSelected({
                        ...selectedLayer,
                        color: event.target.value as GuestbookTextLayerV1["color"],
                      })}
                    >
                      {GUESTBOOK_TEXT_COLORS.map((color) => <option key={color} value={color}>{COLOR_LABELS[color]}</option>)}
                    </select>
                  </label>
                </div>
                <fieldset className={styles.alignments}>
                  <legend>정렬</legend>
                  {GUESTBOOK_TEXT_ALIGNS.map((align) => (
                    <button
                      key={align}
                      type="button"
                      aria-pressed={selectedLayer.align === align}
                      onClick={() => replaceSelected({ ...selectedLayer, align })}
                    >
                      {ALIGN_LABELS[align]}
                    </button>
                  ))}
                </fieldset>
                <label>
                  글씨 크기 <output>{Math.round(selectedLayer.font_size * 100)}%</output>
                  <input
                    type="range"
                    aria-label="글씨 크기"
                    min={GUESTBOOK_EDITOR_LIMITS.textFontSize[0]}
                    max={GUESTBOOK_EDITOR_LIMITS.textFontSize[1]}
                    step="0.005"
                    value={selectedLayer.font_size}
                    onChange={(event) => replaceSelected({ ...selectedLayer, font_size: Number(event.target.value) })}
                  />
                </label>
              </>
            ) : (
              <p className={styles.selectedSticker}>{stickerLabel(selectedLayer.sticker_id)} 스티커</p>
            )}

            <label>
              너비 <output>{Math.round(selectedLayer.width * 100)}%</output>
              <input
                type="range"
                aria-label="요소 너비"
                min={selectedLayer.type === "text"
                  ? GUESTBOOK_EDITOR_LIMITS.textWidth[0]
                  : GUESTBOOK_EDITOR_LIMITS.stickerWidth[0]}
                max={selectedLayer.type === "text"
                  ? GUESTBOOK_EDITOR_LIMITS.textWidth[1]
                  : GUESTBOOK_EDITOR_LIMITS.stickerWidth[1]}
                step="0.005"
                value={selectedLayer.width}
                onChange={(event) => replaceSelected({ ...selectedLayer, width: Number(event.target.value) })}
              />
            </label>
            <label>
              회전 <output>{Math.round(selectedLayer.rotation_deg)}°</output>
              <input
                type="range"
                aria-label="요소 회전"
                min="-180"
                max="180"
                step="1"
                value={selectedLayer.rotation_deg}
                onChange={(event) => replaceSelected({ ...selectedLayer, rotation_deg: Number(event.target.value) })}
              />
            </label>

            <div className={styles.layerActions}>
              <button type="button" onClick={() => moveSelected("front")}>맨 앞으로</button>
              <button type="button" onClick={() => moveSelected("back")}>맨 뒤로</button>
              <button type="button" className={styles.delete} onClick={removeSelected}>삭제</button>
            </div>
          </div>
        ) : (
          <p className={styles.noSelection}>편지 위 요소나 레이어를 선택해주세요.</p>
        )}

        <div className={styles.counts} aria-live="polite">
          <span>글씨 {textCount}/{GUESTBOOK_MAX_TEXT_LAYERS}</span>
          <span>스티커 {stickerCount}/{GUESTBOOK_MAX_STICKER_LAYERS}</span>
          <span className={totalPublicText >= GUESTBOOK_MAX_TOTAL_TEXT ? styles.countWarning : undefined}>
            문구+서명 {totalPublicText}/{GUESTBOOK_MAX_TOTAL_TEXT}
          </span>
        </div>
      </aside>
    </div>
  );
}
