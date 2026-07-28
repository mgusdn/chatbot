"use client";

import { CuboidCollider, RigidBody, TrimeshCollider } from "@react-three/rapier";
import { CommonsPavilion, COMMONS_PAVILION_CONFIG } from "../CommonsPavilion";
import { DistantVista } from "./DistantVista";
import {
  COAST_BOUNDARY_SEGMENTS,
  COAST_FLOOR_MESH,
  EXTERIOR_PERFORMANCE_BUDGETS,
} from "./exteriorLayout";
import { IslandTerrain } from "./IslandTerrain";
import { WorldScenery } from "./WorldScenery";

function WorldColliders() {
  return (
    <RigidBody type="fixed" colliders={false} name="coastal-world-colliders">
      <TrimeshCollider
        args={[COAST_FLOOR_MESH.vertices, COAST_FLOOR_MESH.indices]}
        friction={0.92}
      />
      {COAST_BOUNDARY_SEGMENTS.map((segment, index) => (
        <CuboidCollider
          key={index}
          args={[...segment.halfExtents]}
          position={[...segment.center]}
          rotation={[0, segment.rotationY, 0]}
          friction={0.2}
        />
      ))}
      <CuboidCollider
        args={[...COMMONS_PAVILION_CONFIG.collider.halfExtents]}
        position={[...COMMONS_PAVILION_CONFIG.collider.position]}
      />
    </RigidBody>
  );
}

export function ExteriorWorld() {
  const shadowMapSize = EXTERIOR_PERFORMANCE_BUDGETS.mobile.shadowMapSize;
  return (
    <>
      <color attach="background" args={["#b9d4ce"]} />
      <fog attach="fog" args={["#bfd3ce", 27, 70]} />
      <ambientLight intensity={1.05} />
      <hemisphereLight args={["#fff4d2", "#58716a", 1.35]} />
      <directionalLight
        castShadow
        position={[-7, 12, 9]}
        intensity={2.15}
        color="#fff1ca"
        shadow-mapSize={[shadowMapSize, shadowMapSize]}
        shadow-camera-near={1}
        shadow-camera-far={42}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
      />

      <IslandTerrain />
      <WorldColliders />
      <CommonsPavilion />
      <WorldScenery />
      <DistantVista />
    </>
  );
}
