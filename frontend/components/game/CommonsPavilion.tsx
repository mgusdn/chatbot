"use client";

export const COMMONS_PAVILION_CONFIG = {
  position: [0, 0, -9] as [number, number, number],
  size: [8.6, 3, 5.3] as [number, number, number],
  doorWorldPosition: [0, 0, -6.35] as [number, number, number],
  collider: {
    position: [0, 1.45, -9] as [number, number, number],
    halfExtents: [4.3, 1.45, 2.65] as [number, number, number],
  },
} as const;

function WindowBay({ x }: { x: number }) {
  return (
    <group position={[x, 1.55, 2.67]}>
      <mesh castShadow>
        <boxGeometry args={[2.05, 1.55, 0.13]} />
        <meshStandardMaterial color="#53615e" metalness={0.12} roughness={0.62} />
      </mesh>
      <mesh position={[0, 0, 0.08]}>
        <boxGeometry args={[1.82, 1.32, 0.045]} />
        <meshStandardMaterial color="#a8c0b8" transparent opacity={0.68} metalness={0.08} roughness={0.24} />
      </mesh>
      <mesh position={[0, 0, 0.115]}>
        <boxGeometry args={[0.07, 1.31, 0.025]} />
        <meshStandardMaterial color="#53615e" metalness={0.18} roughness={0.58} />
      </mesh>
      <mesh position={[0, 0, 0.115]}>
        <boxGeometry args={[1.81, 0.07, 0.025]} />
        <meshStandardMaterial color="#53615e" metalness={0.18} roughness={0.58} />
      </mesh>
    </group>
  );
}

/** Wide civic-library facade used by the exterior scene. Physics stays in WorldScene. */
export function CommonsPavilion() {
  return (
    <group position={COMMONS_PAVILION_CONFIG.position} name="mind-research-commons">
      <mesh castShadow receiveShadow position={[0, 1.5, 0]}>
        <boxGeometry args={COMMONS_PAVILION_CONFIG.size} />
        <meshStandardMaterial color="#b7aa98" roughness={0.88} />
      </mesh>

      <mesh castShadow position={[0, 3.08, 0]}>
        <boxGeometry args={[9.05, 0.22, 5.72]} />
        <meshStandardMaterial color="#596761" metalness={0.08} roughness={0.72} />
      </mesh>
      <group position={[0, 3.36, -0.35]}>
        <mesh castShadow>
          <boxGeometry args={[4.7, 0.58, 2.05]} />
          <meshStandardMaterial color="#66746e" roughness={0.72} />
        </mesh>
        <mesh position={[0, 0, 1.045]}>
          <boxGeometry args={[4.25, 0.36, 0.04]} />
          <meshStandardMaterial color="#acc1b8" transparent opacity={0.62} metalness={0.05} roughness={0.25} />
        </mesh>
      </group>

      <WindowBay x={-2.75} />
      <WindowBay x={2.75} />

      <group position={[0, 1.22, 2.7]}>
        {[-0.57, 0.57].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <mesh castShadow>
              <boxGeometry args={[1.08, 2.28, 0.15]} />
              <meshStandardMaterial color="#52625d" metalness={0.12} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.2, 0.09]}>
              <boxGeometry args={[0.82, 1.55, 0.035]} />
              <meshStandardMaterial color="#9eb8b0" transparent opacity={0.64} roughness={0.25} />
            </mesh>
            <mesh position={[x < 0 ? 0.35 : -0.35, 0, 0.13]}>
              <sphereGeometry args={[0.055, 12, 8]} />
              <meshStandardMaterial color="#d8c47f" metalness={0.5} roughness={0.38} />
            </mesh>
          </group>
        ))}
      </group>

      <mesh castShadow position={[0, 2.64, 2.95]}>
        <boxGeometry args={[3.6, 0.2, 1.15]} />
        <meshStandardMaterial color="#596761" metalness={0.1} roughness={0.68} />
      </mesh>
      {[-1.55, 1.55].map((x) => (
        <mesh key={x} castShadow position={[x, 1.42, 3.15]}>
          <boxGeometry args={[0.12, 2.45, 0.12]} />
          <meshStandardMaterial color="#596761" metalness={0.12} roughness={0.65} />
        </mesh>
      ))}

      <group position={[0, 2.55, 2.79]}>
        <mesh>
          <boxGeometry args={[2.25, 0.48, 0.08]} />
          <meshStandardMaterial color="#eee4cc" roughness={0.82} />
        </mesh>
        {[-0.68, -0.23, 0.23, 0.68].map((x, index) => (
          <mesh key={x} position={[x, 0, 0.05]}>
            <boxGeometry args={[0.22, 0.22 + index * 0.045, 0.025]} />
            <meshStandardMaterial color={["#d3a764", "#789787", "#be7467", "#718c9d"][index]} roughness={0.75} />
          </mesh>
        ))}
      </group>

      <mesh receiveShadow position={[0, 0.035, 3.1]}>
        <boxGeometry args={[3.4, 0.07, 1.25]} />
        <meshStandardMaterial color="#8b8173" roughness={0.94} />
      </mesh>
    </group>
  );
}
