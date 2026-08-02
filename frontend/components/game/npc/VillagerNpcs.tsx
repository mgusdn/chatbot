"use client";

import { Billboard, Html, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useState, type MutableRefObject } from "react";
import type { Texture } from "three";
import {
  NPC_SPEECH_RADIUS,
  NPC_SPRITE_HEIGHT,
  VILLAGER_NPCS,
  type VillagerNpcDefinition,
} from "@/constants/villagerNpcs";

export type PlayerPositionRef = MutableRefObject<{ x: number; z: number }>;

/** A flat, always-camera-facing character cutout, sized to the image's own aspect ratio. */
function VillagerSprite({ texture, width }: { texture: Texture; width: number }) {
  return (
    <mesh scale={[width, NPC_SPRITE_HEIGHT, 1]} position={[0, NPC_SPRITE_HEIGHT / 2, 0]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} transparent alphaTest={0.05} toneMapped={false} />
    </mesh>
  );
}

/** A soft contact shadow so the floating cutout reads as standing on the floor. */
function GroundContactShadow() {
  const radius = NPC_SPRITE_HEIGHT * 0.26;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <circleGeometry args={[radius, 24]} />
      <meshBasicMaterial color="#000000" transparent opacity={0.16} />
    </mesh>
  );
}

function VillagerNpc({
  npc,
  playerPositionRef,
}: {
  npc: VillagerNpcDefinition;
  playerPositionRef: PlayerPositionRef;
}) {
  const [nearby, setNearby] = useState(false);
  const texture = useTexture(npc.spriteUrl);
  const image = texture.image as HTMLImageElement | undefined;
  const width = NPC_SPRITE_HEIGHT * (image ? image.width / image.height : 1);

  useFrame(() => {
    const player = playerPositionRef.current;
    const dx = player.x - npc.position[0];
    const dz = player.z - npc.position[2];
    const isNearby = dx * dx + dz * dz <= NPC_SPEECH_RADIUS * NPC_SPEECH_RADIUS;
    if (isNearby !== nearby) setNearby(isNearby);
  });

  return (
    <group position={npc.position}>
      <GroundContactShadow />
      <Billboard>
        <VillagerSprite texture={texture} width={width} />
      </Billboard>
      {nearby ? (
        <Html position={[width / 2 + 0.35, NPC_SPRITE_HEIGHT * 0.82, 0]} center={false} occlude={false}>
          <div className="npc-speech-bubble">{npc.line}</div>
        </Html>
      ) : null}
    </group>
  );
}

export function VillagerNpcs({ playerPositionRef }: { playerPositionRef: PlayerPositionRef }) {
  return (
    <>
      {VILLAGER_NPCS.map((npc) => (
        <VillagerNpc key={npc.id} npc={npc} playerPositionRef={playerPositionRef} />
      ))}
    </>
  );
}

/**
 * Warms the texture cache before WorldScene first mounts these NPCs so a
 * villager sprite never starts loading synchronously inside another
 * component's render (see the same fix applied to preloadInteriorModels).
 */
export function preloadVillagerNpcSprites() {
  VILLAGER_NPCS.forEach((npc) => useTexture.preload(npc.spriteUrl));
}
