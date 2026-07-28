"use client";

import { Instance, Instances } from "@react-three/drei";

const BIRDS = [
  [-10, 5.1, -24],
  [-7.9, 5.8, -27],
  [17, 6.2, -31],
] as const;

function LighthouseIsland() {
  return (
    <group position={[23, -0.12, -34]} scale={0.9} name="distant-lighthouse-island">
      <mesh scale={[7.6, 0.72, 4.6]}>
        <sphereGeometry args={[1, 18, 8]} />
        <meshStandardMaterial color="#8e8a72" roughness={1} />
      </mesh>
      <mesh position={[-0.5, 0.45, 0]} scale={[6.6, 0.48, 3.7]}>
        <sphereGeometry args={[1, 18, 8]} />
        <meshStandardMaterial color="#718b68" roughness={1} />
      </mesh>
      <group position={[1.35, 1.72, -0.2]}>
        <mesh>
          <cylinderGeometry args={[0.34, 0.53, 3.1, 10]} />
          <meshStandardMaterial color="#eee3ce" roughness={0.82} />
        </mesh>
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.355, 0.555, 0.42, 10]} />
          <meshStandardMaterial color="#bf725f" roughness={0.85} />
        </mesh>
        <mesh position={[0, 1.72, 0]}>
          <cylinderGeometry args={[0.48, 0.48, 0.43, 10]} />
          <meshStandardMaterial color="#6e8985" roughness={0.56} />
        </mesh>
        <mesh position={[0, 2.04, 0]}>
          <coneGeometry args={[0.58, 0.48, 10]} />
          <meshStandardMaterial color="#b96958" roughness={0.78} />
        </mesh>
        <mesh position={[0, 1.72, 0]}>
          <sphereGeometry args={[0.17, 8, 6]} />
          <meshStandardMaterial color="#f3dc8c" emissive="#e9c96d" emissiveIntensity={0.35} />
        </mesh>
      </group>
      {[-3.7, -2.2, 3.9].map((x, index) => (
        <group key={x} position={[x, 1 + index * 0.08, 0.25 - index * 0.45]}>
          <mesh position={[0, -0.48, 0]}>
            <cylinderGeometry args={[0.13, 0.18, 0.95, 7]} />
            <meshStandardMaterial color="#665442" roughness={1} />
          </mesh>
          <mesh scale={[0.95, 0.75, 0.95]}>
            <icosahedronGeometry args={[0.7, 1]} />
            <meshStandardMaterial color={index === 1 ? "#66815e" : "#748e68"} roughness={1} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function DistantBoat() {
  return (
    <group position={[-21, -0.05, -26]} rotation={[0, 0.36, 0]} scale={0.85} name="distant-boat">
      <mesh scale={[1.7, 0.38, 0.7]}>
        <sphereGeometry args={[1, 12, 6]} />
        <meshStandardMaterial color="#705b4d" roughness={0.92} />
      </mesh>
      <mesh position={[0, 1.18, 0]}>
        <cylinderGeometry args={[0.04, 0.055, 2.35, 6]} />
        <meshStandardMaterial color="#594b42" roughness={0.9} />
      </mesh>
      <mesh position={[0.55, 1.38, 0]} rotation={[0, 0, -0.08]}>
        <coneGeometry args={[1.08, 1.8, 3]} />
        <meshStandardMaterial color="#e6d7b9" roughness={0.84} side={2} />
      </mesh>
    </group>
  );
}

function SeagullSilhouettes() {
  return (
    <Instances limit={BIRDS.length * 2}>
      <boxGeometry args={[0.42, 0.035, 0.045]} />
      <meshBasicMaterial color="#f1eee2" />
      {BIRDS.flatMap(([x, y, z], index) => [
        <Instance
          key={`${index}-left`}
          position={[x - 0.18, y, z]}
          rotation={[0, 0, -0.32]}
          scale={0.8 + index * 0.12}
        />,
        <Instance
          key={`${index}-right`}
          position={[x + 0.18, y, z]}
          rotation={[0, 0, 0.32]}
          scale={0.8 + index * 0.12}
        />,
      ])}
    </Instances>
  );
}

/** Non-playable silhouettes imply a world beyond the island without open-world cost. */
export function DistantVista() {
  return (
    <group name="distant-coastal-vista">
      <LighthouseIsland />
      <DistantBoat />
      <SeagullSilhouettes />
    </group>
  );
}
