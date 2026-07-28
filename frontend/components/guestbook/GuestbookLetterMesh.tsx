"use client";

import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
} from "three";
import {
  createGuestbookDesignCanvas,
  ensureGuestbookSignatureFontReady,
  getGuestbookTemplate,
} from "@/lib/guestbook";
import { GUESTBOOK_LETTER_SIZE } from "@/lib/guestbook/guestbookPlacement";
import type { GuestbookDesign } from "@/types/memoryRoom";

export type GuestbookLetterMeshProps = {
  design: GuestbookDesign;
  width?: number;
  height?: number;
  opacity?: number;
  selected?: boolean;
  valid?: boolean;
  resolution?: "standard" | "high";
};

export function GuestbookLetterMesh({
  design,
  width = GUESTBOOK_LETTER_SIZE[0],
  height = GUESTBOOK_LETTER_SIZE[1],
  opacity = 1,
  selected = false,
  valid = true,
  resolution = "standard",
}: GuestbookLetterMeshProps) {
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy());
  const [fontRevision, setFontRevision] = useState(0);
  const template = getGuestbookTemplate(design.template_id);

  useEffect(() => {
    let current = true;
    void ensureGuestbookSignatureFontReady().then(() => {
      if (current) setFontRevision((revision) => revision + 1);
    });
    return () => { current = false; };
  }, []);

  const texture = useMemo(() => {
    const pixelWidth = resolution === "high" ? 1024 : 512;
    const canvas = createGuestbookDesignCanvas(design, pixelWidth, Math.round(pixelWidth / 1.6));
    if (!canvas) return null;
    const next = new CanvasTexture(canvas);
    next.colorSpace = SRGBColorSpace;
    next.minFilter = LinearMipmapLinearFilter;
    next.magFilter = LinearFilter;
    next.generateMipmaps = true;
    next.anisotropy = Math.min(8, maxAnisotropy);
    next.needsUpdate = true;
    return next;
  }, [design, fontRevision, maxAnisotropy, resolution]);

  useEffect(() => () => texture?.dispose(), [texture]);

  const safeOpacity = Math.max(0, Math.min(1, opacity));
  return (
    <group
      name="guestbook-letter-artwork"
      scale={selected ? 1.035 : 1}
      userData={{ guestbookLetter: true }}
    >
      <mesh position={[0, 0, -0.018]} castShadow={safeOpacity >= 0.99}>
        <boxGeometry args={[width + 0.035, height + 0.035, 0.032]} />
        <meshStandardMaterial
          color={valid ? template.edgeColor : "#bd5c58"}
          roughness={0.94}
          transparent={safeOpacity < 1}
          opacity={safeOpacity}
          depthWrite={safeOpacity >= 0.99}
        />
      </mesh>
      <mesh position={[0, 0, 0.004]} renderOrder={20}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          map={texture}
          color={valid ? "#ffffff" : "#f2aaa2"}
          transparent={safeOpacity < 1}
          opacity={safeOpacity}
          depthWrite={safeOpacity >= 0.99}
          polygonOffset
          polygonOffsetFactor={-2}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
