"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import type { CharacterId } from "@/types/character";
import { CharacterPreviewScene } from "../CharacterPreviewScene";

export default function CharacterPreviewCanvas({ characterId }: { characterId: CharacterId }) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ fov: 32, near: 0.1, far: 40, position: [0, 1.65, 5.7] }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      fallback={<div>3D 주민을 표시할 수 없어요.</div>}
    >
      <Suspense fallback={null}>
        <CharacterPreviewScene characterId={characterId} />
      </Suspense>
    </Canvas>
  );
}
