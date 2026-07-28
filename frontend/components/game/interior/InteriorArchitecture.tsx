"use client";

import { useTexture } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect } from "react";
import { RepeatWrapping, SRGBColorSpace, Vector2 } from "three";
import {
  INTERIOR_FURNITURE_COLLIDERS,
  INTERIOR_ENTRY_PORCH,
  INTERIOR_ENTRANCE_WIDTH,
  INTERIOR_EXIT_GUARD,
  INTERIOR_HALF_DEPTH,
  INTERIOR_MAIN_PATH_HALF_WIDTH,
  INTERIOR_PLAN_SCALE,
  INTERIOR_ROOMS,
  INTERIOR_SIZE,
  INTERIOR_WALLS,
} from "@/constants/interiorLayout";

const WOOD_NORMAL_SCALE = new Vector2(0.16, 0.16);
const PLASTER_NORMAL_SCALE = new Vector2(0.1, 0.1);
const INTERIOR_TEXTURE_URLS = [
  "/textures/interior/wood-floor-color.jpg",
  "/textures/interior/wood-floor-normal.jpg",
  "/textures/interior/wood-floor-roughness.jpg",
  "/textures/interior/plaster-color.jpg",
  "/textures/interior/plaster-normal.jpg",
  "/textures/interior/plaster-roughness.jpg",
];

export function preloadInteriorTextures() {
  useTexture.preload(INTERIOR_TEXTURE_URLS);
}

function EntrancePortal() {
  return (
    <group position={[0, 0, INTERIOR_HALF_DEPTH]}>
      {[-INTERIOR_ENTRANCE_WIDTH / 2, INTERIOR_ENTRANCE_WIDTH / 2].map((x) => (
        <mesh key={x} castShadow position={[x, 1.05, 0]}>
          <boxGeometry args={[0.16, 2.1, 0.26]} />
          <meshStandardMaterial color="#52625d" metalness={0.12} roughness={0.65} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 2.12, 0]}>
        <boxGeometry args={[INTERIOR_ENTRANCE_WIDTH + 0.16, 0.18, 0.28]} />
        <meshStandardMaterial color="#52625d" metalness={0.12} roughness={0.65} />
      </mesh>
      <mesh position={[0, 2.12, 0.17]}>
        <boxGeometry args={[1.6, 0.3, 0.04]} />
        <meshStandardMaterial color="#d9c68f" emissive="#a78c57" emissiveIntensity={0.2} roughness={0.7} />
      </mesh>
    </group>
  );
}

export function InteriorArchitecture() {
  const [woodColor, woodNormal, woodRoughness, plasterColor, plasterNormal, plasterRoughness] = useTexture(INTERIOR_TEXTURE_URLS);

  useEffect(() => {
    [woodColor, woodNormal, woodRoughness].forEach((texture) => {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.repeat.set(4.5, 4.5);
      texture.needsUpdate = true;
    });
    [plasterColor, plasterNormal, plasterRoughness].forEach((texture) => {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.repeat.set(3, 2);
      texture.needsUpdate = true;
    });
    woodColor.colorSpace = SRGBColorSpace;
    plasterColor.colorSpace = SRGBColorSpace;
  }, [plasterColor, plasterNormal, plasterRoughness, woodColor, woodNormal, woodRoughness]);

  return (
    <>
      <mesh receiveShadow position={[0, -0.14, 0]}>
        <boxGeometry args={[INTERIOR_SIZE[0], 0.28, INTERIOR_SIZE[1]]} />
        <meshStandardMaterial color="#865b43" roughness={0.96} />
      </mesh>

      <mesh receiveShadow position={INTERIOR_ENTRY_PORCH.position}>
        <boxGeometry args={[
          INTERIOR_ENTRY_PORCH.halfExtents[0] * 2,
          INTERIOR_ENTRY_PORCH.halfExtents[1] * 2,
          INTERIOR_ENTRY_PORCH.halfExtents[2] * 2,
        ]} />
        <meshStandardMaterial color="#766f65" roughness={0.88} />
      </mesh>

      {INTERIOR_ROOMS.map((room) => (
        <mesh key={room.id} receiveShadow position={[room.center[0], 0.012, room.center[1]]}>
          <boxGeometry args={[room.size[0], 0.025, room.size[1]]} />
          <meshStandardMaterial
            color={room.floorColor}
            map={woodColor}
            normalMap={woodNormal}
            normalScale={WOOD_NORMAL_SCALE}
            roughness={0.92}
            roughnessMap={woodRoughness}
          />
        </mesh>
      ))}

      {[-INTERIOR_MAIN_PATH_HALF_WIDTH, INTERIOR_MAIN_PATH_HALF_WIDTH].map((x) => (
        <mesh key={x} position={[x, 0.038, 2.15 * INTERIOR_PLAN_SCALE]}>
          <boxGeometry args={[0.035, 0.022, 10.3 * INTERIOR_PLAN_SCALE]} />
          <meshStandardMaterial color="#d1bc88" emissive="#9f8659" emissiveIntensity={0.08} roughness={0.8} />
        </mesh>
      ))}

      {[-3.1, -1.5, 0.1, 1.7, 3.3, 4.9, 6.5].map((baseZ) => (
        <mesh key={baseZ} position={[0, 0.039, baseZ * INTERIOR_PLAN_SCALE]}>
          <boxGeometry args={[INTERIOR_MAIN_PATH_HALF_WIDTH * 2, 0.02, 0.025]} />
          <meshStandardMaterial color="#d1bc88" transparent opacity={0.42} roughness={0.85} />
        </mesh>
      ))}

      {INTERIOR_WALLS.map((wall) => (
        <group key={wall.id}>
          <mesh castShadow receiveShadow position={wall.position}>
            <boxGeometry args={wall.size} />
            <meshStandardMaterial
              color={wall.color}
              map={plasterColor}
              normalMap={plasterNormal}
              normalScale={PLASTER_NORMAL_SCALE}
              roughness={0.96}
              roughnessMap={plasterRoughness}
            />
          </mesh>
          <mesh position={[wall.position[0], 0.11, wall.position[2]]}>
            <boxGeometry args={[wall.size[0] + 0.03, 0.2, wall.size[2] + 0.03]} />
            <meshStandardMaterial color="#875e47" roughness={0.9} />
          </mesh>
        </group>
      ))}

      <EntrancePortal />

      <RigidBody type="fixed" colliders={false} name="interior-static-colliders">
        <CuboidCollider args={[INTERIOR_SIZE[0] / 2, 0.16, INTERIOR_SIZE[1] / 2]} position={[0, -0.16, 0]} />
        <CuboidCollider args={[...INTERIOR_ENTRY_PORCH.halfExtents]} position={INTERIOR_ENTRY_PORCH.position} />
        <CuboidCollider args={[...INTERIOR_EXIT_GUARD.halfExtents]} position={INTERIOR_EXIT_GUARD.position} />
        {INTERIOR_WALLS.map((wall) => (
          <CuboidCollider
            key={wall.id}
            args={[wall.size[0] / 2, wall.size[1] / 2, wall.size[2] / 2]}
            position={wall.position}
          />
        ))}
        {INTERIOR_FURNITURE_COLLIDERS.map((collider) => (
          <CuboidCollider
            key={collider.id}
            args={[collider.halfExtents[0], collider.halfExtents[1], collider.halfExtents[2]]}
            position={collider.position}
          />
        ))}
      </RigidBody>
    </>
  );
}
