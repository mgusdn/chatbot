"use client";

import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, Shape, Vector2 } from "three";
import {
  COAST_LAYER_CONFIG,
  PLAYABLE_COASTLINE,
  scaleOutline,
  type PlanarPoint,
} from "./exteriorLayout";

const createShape = (outline: readonly PlanarPoint[]) => {
  // ShapeGeometry lives in XY. Negating Z before the -90deg rotation keeps the
  // authored XZ winding and produces upward-facing terrain.
  const points = outline.map(([x, z]) => new Vector2(x, -z));
  return new Shape(points);
};

const createFoamGeometry = () => {
  const inner = scaleOutline(PLAYABLE_COASTLINE, COAST_LAYER_CONFIG.foam.innerScale);
  const outer = scaleOutline(PLAYABLE_COASTLINE, COAST_LAYER_CONFIG.foam.outerScale);
  const vertexCount = PLAYABLE_COASTLINE.length;
  const positions = new Float32Array(vertexCount * 2 * 3);
  const indices = new Uint32Array(vertexCount * 6);

  for (let index = 0; index < vertexCount; index += 1) {
    const next = (index + 1) % vertexCount;
    positions.set([inner[index][0], COAST_LAYER_CONFIG.foam.y, inner[index][1]], index * 6);
    positions.set([outer[index][0], COAST_LAYER_CONFIG.foam.y, outer[index][1]], index * 6 + 3);
    indices.set([
      index * 2,
      next * 2,
      index * 2 + 1,
      next * 2,
      next * 2 + 1,
      index * 2 + 1,
    ], index * 6);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
};

function TerrainLayer({ scale, y, color }: { scale: number; y: number; color: string }) {
  const shape = useMemo(() => createShape(scaleOutline(PLAYABLE_COASTLINE, scale)), [scale]);
  return (
    <mesh receiveShadow position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color={color} roughness={0.96} />
    </mesh>
  );
}

function OceanSurface() {
  return (
    <>
      <mesh position={[0, COAST_LAYER_CONFIG.deepOcean.y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[COAST_LAYER_CONFIG.deepOcean.radius, 96]} />
        <meshStandardMaterial
          color={COAST_LAYER_CONFIG.deepOcean.color}
          roughness={0.34}
          metalness={0.04}
        />
      </mesh>
      <TerrainLayer {...COAST_LAYER_CONFIG.shallowWater} />
    </>
  );
}

function FoamLine() {
  const geometry = useMemo(createFoamGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} renderOrder={3}>
      <meshBasicMaterial
        color="#f5f0d8"
        transparent
        opacity={0.78}
        depthWrite={false}
      />
    </mesh>
  );
}

/** Low-cost nested silhouettes: opaque ocean, then shallow water, wet sand, dry sand, and grass. */
export function IslandTerrain() {
  return (
    <group name="coastal-island-terrain">
      <OceanSurface />
      <TerrainLayer {...COAST_LAYER_CONFIG.wetSand} />
      <TerrainLayer {...COAST_LAYER_CONFIG.drySand} />
      <TerrainLayer {...COAST_LAYER_CONFIG.grass} />
      <FoamLine />
    </group>
  );
}
