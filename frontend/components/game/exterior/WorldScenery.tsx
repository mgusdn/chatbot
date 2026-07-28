"use client";

import { Instance, Instances } from "@react-three/drei";

const TREES = [
  { position: [-8, 0, -7] as const, scale: 0.95 },
  { position: [8.2, 0, -6.4] as const, scale: 1.03 },
  { position: [-8.7, 0, 0] as const, scale: 1.11 },
  { position: [8.6, 0, 1] as const, scale: 0.95 },
  { position: [-7.6, 0, 7.2] as const, scale: 1.03 },
  { position: [7.4, 0, 7.7] as const, scale: 1.11 },
] as const;

const LAMPS = [
  [-2.1, 0, -3.4],
  [2.1, 0, 2.7],
  [2.2, 0, -6.2],
] as const;

const FLOWERS = [
  { position: [-2.7, 0, 5.1] as const, color: "#e99383" },
  { position: [2.6, 0, 5.4] as const, color: "#f0cf66" },
  { position: [-3.2, 0, -3.8] as const, color: "#e3a2bd" },
  { position: [3.15, 0, -2.5] as const, color: "#b6a3d8" },
  { position: [4.4, 0, 4.5] as const, color: "#f1a076" },
] as const;

const COAST_ROCKS = [
  { position: [13.8, -0.11, 5.5] as const, scale: [0.75, 0.42, 0.58] as const },
  { position: [13.1, -0.14, 6.5] as const, scale: [0.42, 0.25, 0.34] as const },
  { position: [-14.1, -0.12, -1.3] as const, scale: [0.62, 0.34, 0.48] as const },
  { position: [-13.5, -0.15, -2.1] as const, scale: [0.33, 0.2, 0.28] as const },
  { position: [7.1, -0.13, 13.35] as const, scale: [0.55, 0.31, 0.43] as const },
] as const;

function Trees() {
  return (
    <group name="village-trees">
      <Instances castShadow limit={TREES.length}>
        <cylinderGeometry args={[0.17, 0.24, 1.3, 8]} />
        <meshStandardMaterial color="#76523b" roughness={1} />
        {TREES.map(({ position, scale }, index) => (
          <Instance
            key={index}
            position={[position[0], 0.65 * scale, position[2]]}
            scale={scale}
          />
        ))}
      </Instances>
      <Instances castShadow limit={TREES.length}>
        <icosahedronGeometry args={[0.83, 1]} />
        <meshStandardMaterial color="#75945d" roughness={1} />
        {TREES.map(({ position, scale }, index) => (
          <Instance
            key={index}
            position={[position[0], 1.65 * scale, position[2]]}
            scale={[scale, scale * 0.9, scale]}
          />
        ))}
      </Instances>
      <Instances castShadow limit={TREES.length}>
        <icosahedronGeometry args={[0.72, 1]} />
        <meshStandardMaterial color="#88a968" roughness={1} />
        {TREES.map(({ position, scale }, index) => (
          <Instance
            key={index}
            position={[position[0] - 0.42 * scale, 1.43 * scale, position[2] + 0.1]}
            scale={scale * 0.62}
          />
        ))}
      </Instances>
      <Instances castShadow limit={TREES.length}>
        <icosahedronGeometry args={[0.72, 1]} />
        <meshStandardMaterial color="#6f8c57" roughness={1} />
        {TREES.map(({ position, scale }, index) => (
          <Instance
            key={index}
            position={[position[0] + 0.46 * scale, 1.47 * scale, position[2] - 0.06]}
            scale={scale * 0.58}
          />
        ))}
      </Instances>
    </group>
  );
}

function Lamps() {
  return (
    <group name="village-lamps">
      <Instances castShadow limit={LAMPS.length}>
        <cylinderGeometry args={[0.055, 0.07, 1.5, 8]} />
        <meshStandardMaterial color="#405048" roughness={0.72} />
        {LAMPS.map(([x, , z]) => <Instance key={`${x}-${z}`} position={[x, 0.75, z]} />)}
      </Instances>
      <Instances castShadow limit={LAMPS.length}>
        <sphereGeometry args={[0.18, 12, 8]} />
        <meshStandardMaterial color="#fff1b8" emissive="#ffd98a" emissiveIntensity={0.6} />
        {LAMPS.map(([x, , z]) => <Instance key={`${x}-${z}`} position={[x, 1.5, z]} />)}
      </Instances>
    </group>
  );
}

function Flowers() {
  return (
    <group name="village-flowers">
      <Instances limit={FLOWERS.length}>
        <cylinderGeometry args={[0.018, 0.022, 0.34, 6]} />
        <meshStandardMaterial color="#4f7848" roughness={0.9} />
        {FLOWERS.map(({ position }) => (
          <Instance key={`${position[0]}-${position[2]}`} position={[position[0], 0.17, position[2]]} />
        ))}
      </Instances>
      <Instances limit={FLOWERS.length}>
        <sphereGeometry args={[0.055, 8, 6]} />
        <meshStandardMaterial color="#f2c85d" roughness={0.8} />
        {FLOWERS.map(({ position }) => (
          <Instance key={`${position[0]}-${position[2]}`} position={[position[0], 0.36, position[2]]} />
        ))}
      </Instances>
      {FLOWERS.map(({ position, color }) => (
        <Instances key={color} limit={5}>
          <sphereGeometry args={[0.075, 8, 6]} />
          <meshStandardMaterial color={color} roughness={0.86} />
          {Array.from({ length: 5 }, (_, index) => {
            const angle = index / 5 * Math.PI * 2;
            return (
              <Instance
                key={index}
                position={[
                  position[0] + Math.cos(angle) * 0.09,
                  0.36,
                  position[2] + Math.sin(angle) * 0.09,
                ]}
                scale={[1, 0.55, 1]}
              />
            );
          })}
        </Instances>
      ))}
    </group>
  );
}

function CoastDetails() {
  return (
    <group name="coast-details">
      <Instances castShadow limit={COAST_ROCKS.length}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#817e6d" roughness={0.98} />
        {COAST_ROCKS.map(({ position, scale }, index) => (
          <Instance key={index} position={position} scale={scale} rotation={[0, index * 0.73, 0.12]} />
        ))}
      </Instances>
      <Instances limit={6}>
        <sphereGeometry args={[0.15, 8, 5]} />
        <meshStandardMaterial color="#eee0b8" roughness={0.9} />
        {[
          [-9.6, -0.005, 10.25], [-10.3, -0.018, 9.65], [9.85, -0.008, 10.05],
          [11.2, -0.025, -8.45], [-9.9, -0.012, -10.3], [5.1, -0.005, 12.45],
        ].map((position, index) => (
          <Instance key={index} position={position as [number, number, number]} scale={[1, 0.35, 0.72]} rotation={[0, index, 0]} />
        ))}
      </Instances>
    </group>
  );
}

function VillageDetails() {
  return (
    <>
      <mesh receiveShadow position={[0, 0.014, -0.3]} rotation={[-Math.PI / 2, 0, 0]} scale={[2.1, 1, 1]}>
        <planeGeometry args={[2.25, 16]} />
        <meshStandardMaterial color="#d6c69f" roughness={1} />
      </mesh>
      <mesh receiveShadow position={[-4.2, 0.021, 2.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.2, 40]} />
        <meshStandardMaterial color="#6f9fa0" roughness={0.35} metalness={0.03} />
      </mesh>
      <mesh position={[-4.2, 0.035, 2.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.03, 2.25, 40]} />
        <meshStandardMaterial color="#b7aa83" roughness={1} />
      </mesh>
      <group position={[4.3, 0.38, 1.5]}>
        <mesh castShadow position={[0, 0.18, 0]}>
          <boxGeometry args={[2.1, 0.16, 0.65]} />
          <meshStandardMaterial color="#876343" roughness={0.9} />
        </mesh>
        {[-0.8, 0.8].map((x) => (
          <mesh key={x} position={[x, -0.18, 0]}>
            <boxGeometry args={[0.16, 0.7, 0.55]} />
            <meshStandardMaterial color="#76553c" roughness={0.94} />
          </mesh>
        ))}
      </group>
    </>
  );
}

export function WorldScenery() {
  return (
    <group name="exterior-world-scenery">
      <VillageDetails />
      <Trees />
      <Lamps />
      <Flowers />
      <CoastDetails />
    </group>
  );
}
