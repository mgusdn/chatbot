"use client";

import { Instance, Instances } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import {
  ACESFilmicToneMapping,
  DoubleSide,
  SRGBColorSpace,
  Shape,
  type Group,
} from "three";
import { PbaoModel } from "../PbaoModel";

type SceneProps = { reducedMotion: boolean };

type TreeSpec = readonly [x: number, z: number, scale: number, color: string, fruit: boolean];

const TREES: readonly TreeSpec[] = [
  [-6.3, 5.1, 1.34, "#56844f", true],
  [-5.55, 2.15, 1.02, "#70a75d", false],
  [-6.25, -0.85, 1.18, "#4f8050", true],
  [-5.5, -3.9, 0.92, "#77ad62", false],
  [-6.75, -7.15, 1.12, "#5f9554", true],
  [6.4, 5.35, 1.3, "#598b50", false],
  [5.65, 2.2, 0.98, "#79ad61", true],
  [6.35, -0.65, 1.16, "#4f8250", false],
  [5.45, -3.75, 0.94, "#6ca15b", true],
  [6.85, -7.05, 1.16, "#578b50", false],
  [-3.55, -8.15, 0.82, "#79aa61", true],
  [3.75, -8.1, 0.88, "#609453", false],
];

const PATH_PATCHES = [
  [0.12, 5.45, 1.18, 0.82, -0.08],
  [-0.08, 4.25, 1.24, 0.82, 0.06],
  [0.18, 3.05, 1.2, 0.78, -0.04],
  [0.05, 1.8, 1.08, 0.73, 0.08],
  [-0.2, 0.6, 1.02, 0.69, -0.1],
  [0.05, -0.58, 0.95, 0.66, 0.05],
  [0.42, -1.74, 0.9, 0.62, 0.12],
  [0.9, -2.86, 0.86, 0.58, 0.17],
  [1.55, -3.72, 0.79, 0.54, 0.22],
] as const;

const SHRUBS = [
  [-4.4, 4.1, 0.58, "#77a95f"], [-3.9, 3.65, 0.46, "#8abc69"],
  [-4.7, 0.5, 0.55, "#6ca058"], [-3.8, -1.25, 0.43, "#8cbb6a"],
  [-4.35, -3.2, 0.5, "#609353"], [-2.95, -3.7, 0.42, "#82b566"],
  [4.4, 4.25, 0.6, "#75a65c"], [3.7, 3.72, 0.44, "#90bf6c"],
  [4.55, 0.78, 0.52, "#629754"], [3.75, -0.95, 0.46, "#85b466"],
  [4.25, -3.15, 0.55, "#6ba058"], [2.95, -3.68, 0.4, "#8abb69"],
  [-1.9, -6.9, 0.38, "#7eb063"], [0.05, -7.18, 0.48, "#659854"],
  [2.1, -6.85, 0.4, "#89b969"],
] as const;

const FLOWERS = [
  [-2.85, 3.05, "#f6c565"], [-3.12, 2.72, "#f39a7c"], [-2.58, 2.63, "#fff0c1"],
  [2.65, 2.85, "#f0a0b1"], [2.95, 2.55, "#f7d16d"], [3.18, 2.92, "#fff3c7"],
  [-3.15, -1.85, "#ef91a7"], [-2.82, -2.15, "#f6d66e"],
  [3.25, -2.0, "#9fcce0"], [3.58, -2.25, "#f4a17d"],
  [-1.3, -3.35, "#f7cf66"], [2.15, -3.48, "#f4a0b3"],
] as const;

function ForestTrees() {
  const fruitTrees = TREES.filter((tree) => tree[4]);

  return (
    <>
      <Instances castShadow limit={TREES.length}>
        <cylinderGeometry args={[0.22, 0.32, 1.45, 9]} />
        <meshStandardMaterial color="#7e5a3d" roughness={0.94} />
        {TREES.map(([x, z, scale], index) => (
          <Instance key={index} position={[x, 0.72 * scale, z]} scale={scale} />
        ))}
      </Instances>

      <Instances castShadow limit={TREES.length * 3}>
        <dodecahedronGeometry args={[1, 1]} />
        <meshStandardMaterial roughness={0.9} />
        {TREES.flatMap(([x, z, scale, color], index) => [
          <Instance key={`${index}-c`} color={color} position={[x, 1.98 * scale, z]} scale={[1.06 * scale, 0.88 * scale, 1.01 * scale]} />,
          <Instance key={`${index}-l`} color={index % 2 ? "#8bc06c" : "#91c572"} position={[x - 0.53 * scale, 1.76 * scale, z + 0.05]} scale={[0.7 * scale, 0.62 * scale, 0.68 * scale]} />,
          <Instance key={`${index}-r`} color={index % 3 ? "#6da35b" : "#75ac60"} position={[x + 0.54 * scale, 1.74 * scale, z - 0.04]} scale={[0.68 * scale, 0.61 * scale, 0.67 * scale]} />,
        ])}
      </Instances>

      <Instances castShadow limit={fruitTrees.length * 3}>
        <sphereGeometry args={[0.13, 12, 9]} />
        <meshStandardMaterial color="#f2a06f" roughness={0.78} />
        {fruitTrees.flatMap(([x, z, scale], index) => [
          <Instance key={`${index}-a`} position={[x - 0.34 * scale, 1.88 * scale, z + 0.72 * scale]} scale={scale} />,
          <Instance key={`${index}-b`} position={[x + 0.45 * scale, 1.7 * scale, z + 0.65 * scale]} scale={scale * 0.92} />,
          <Instance key={`${index}-c`} position={[x + 0.03, 2.22 * scale, z + 0.74 * scale]} scale={scale * 0.86} />,
        ])}
      </Instances>
    </>
  );
}

function RiverAndBridge() {
  const riverShape = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(-10, 4.08);
    shape.bezierCurveTo(-6.8, 3.65, -3.5, 4.72, -0.5, 4.18);
    shape.bezierCurveTo(2.2, 3.72, 5.35, 4.56, 10, 3.88);
    shape.lineTo(10, 7.12);
    shape.bezierCurveTo(6.6, 7.42, 3.3, 6.34, 0.1, 6.92);
    shape.bezierCurveTo(-3.1, 7.5, -6.45, 6.45, -10, 6.82);
    shape.closePath();
    return shape;
  }, []);
  const bridgeSlats = [-6.28, -5.94, -5.6, -5.26, -4.92, -4.58];

  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <shapeGeometry args={[riverShape, 24]} />
        <meshStandardMaterial color="#65b8c5" roughness={0.3} metalness={0.04} side={DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-2.2, 0.03, -5.23]}>
        <planeGeometry args={[3.5, 0.055]} />
        <meshBasicMaterial color="#c9f2e8" transparent opacity={0.52} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, -0.06]} position={[5.25, 0.032, -5.62]}>
        <planeGeometry args={[2.6, 0.045]} />
        <meshBasicMaterial color="#d9f8ed" transparent opacity={0.48} />
      </mesh>

      <Instances castShadow receiveShadow limit={bridgeSlats.length}>
        <boxGeometry args={[1.78, 0.16, 0.3]} />
        <meshStandardMaterial color="#ad7b4f" roughness={0.82} />
        {bridgeSlats.map((z, index) => (
          <Instance key={z} position={[2.42, 0.18 + Math.sin(index * 0.8) * 0.012, z]} rotation={[0, 0.015 * (index - 2), 0]} />
        ))}
      </Instances>
      {[-0.73, 0.73].map((x) => (
        <mesh key={x} castShadow position={[2.42 + x, 0.12, -5.42]}>
          <boxGeometry args={[0.11, 0.22, 2.15]} />
          <meshStandardMaterial color="#825a3d" roughness={0.88} />
        </mesh>
      ))}
    </group>
  );
}

function MeadowDetails() {
  return (
    <>
      <Instances receiveShadow limit={PATH_PATCHES.length}>
        <circleGeometry args={[1, 22]} />
        <meshStandardMaterial color="#d8c992" roughness={1} />
        {PATH_PATCHES.map(([x, z, sx, sz, rotation], index) => (
          <Instance key={index} position={[x, 0.018, z]} rotation={[-Math.PI / 2, 0, rotation]} scale={[sx, sz, 1]} />
        ))}
      </Instances>

      <Instances castShadow limit={SHRUBS.length}>
        <dodecahedronGeometry args={[1, 1]} />
        <meshStandardMaterial roughness={0.95} />
        {SHRUBS.map(([x, z, scale, color], index) => (
          <Instance key={index} color={color} position={[x, scale * 0.55, z]} scale={[scale * 1.25, scale * 0.78, scale]} />
        ))}
      </Instances>

      <Instances castShadow limit={FLOWERS.length}>
        <cylinderGeometry args={[1, 1, 1, 6]} />
        <meshStandardMaterial color="#4f824b" roughness={0.9} />
        {FLOWERS.map(([x, z], index) => {
          const scale = 0.72 + (index % 3) * 0.08;
          return <Instance key={index} position={[x, 0.16 * scale, z]} scale={[0.018 * scale, 0.32 * scale, 0.018 * scale]} />;
        })}
      </Instances>

      <Instances castShadow limit={FLOWERS.length * 5}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial roughness={0.82} />
        {FLOWERS.flatMap(([x, z, color], index) => {
          const scale = 0.72 + (index % 3) * 0.08;
          return [0, 1, 2, 3, 4].map((petal) => {
            const angle = (petal / 5) * Math.PI * 2;
            return (
              <Instance
                key={`${index}-${petal}`}
                color={color}
                position={[x + Math.cos(angle) * 0.075 * scale, 0.34 * scale, z + Math.sin(angle) * 0.075 * scale]}
                scale={[0.064 * scale, 0.034 * scale, 0.064 * scale]}
              />
            );
          });
        })}
      </Instances>

      <Instances castShadow limit={FLOWERS.length}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#e6a84f" roughness={0.8} />
        {FLOWERS.map(([x, z], index) => {
          const scale = 0.72 + (index % 3) * 0.08;
          return <Instance key={index} position={[x, 0.34 * scale, z]} scale={0.047 * scale} />;
        })}
      </Instances>

      <Instances castShadow limit={8}>
        <dodecahedronGeometry args={[0.22, 1]} />
        <meshStandardMaterial color="#9b9b79" roughness={0.96} />
        {[
          [-2.25, 0.16, -3.68, 1.15], [-1.62, 0.13, -3.95, 0.86], [0.25, 0.14, -4.02, 0.92],
          [3.92, 0.15, -3.93, 1.05], [4.72, 0.13, -4.24, 0.82], [-4.9, 0.16, -4.12, 1.08],
          [-3.8, 0.12, -6.72, 0.76], [4.2, 0.12, -6.85, 0.82],
        ].map(([x, y, z, scale], index) => (
          <Instance key={index} position={[x, y, z]} scale={[scale, scale * 0.64, scale]} rotation={[0, index * 0.43, 0]} />
        ))}
      </Instances>
    </>
  );
}

function WelcomeProps() {
  return (
    <>
      <group position={[-1.75, 0, 1.62]} rotation={[0, 0.18, 0]}>
        <mesh castShadow position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.055, 0.075, 1, 8]} />
          <meshStandardMaterial color="#6c523d" roughness={0.9} />
        </mesh>
        <mesh castShadow position={[0.05, 0.93, 0]} rotation={[0, 0, -0.04]}>
          <boxGeometry args={[0.92, 0.5, 0.12]} />
          <meshStandardMaterial color="#f4e3b2" roughness={0.86} />
        </mesh>
      </group>

      <group position={[1.55, 0, 1.55]}>
        {[0, 0.22, 0.44].map((offset, index) => (
          <group key={offset} position={[offset - 0.22, 0, index % 2 ? 0.08 : 0]} rotation={[0, 0, index === 1 ? 0.06 : -0.04]}>
            <mesh castShadow position={[0, 0.45 + index * 0.08, 0]}>
              <cylinderGeometry args={[0.045, 0.055, 0.9 + index * 0.16, 9]} />
              <meshStandardMaterial color={index === 1 ? "#5e9a55" : "#78ae62"} roughness={0.88} />
            </mesh>
            <mesh position={[0.13, 0.67 + index * 0.09, 0]} rotation={[0, 0, -0.62]} scale={[1.55, 0.7, 1]}>
              <sphereGeometry args={[0.11, 9, 7]} />
              <meshStandardMaterial color="#86ba68" roughness={0.9} />
            </mesh>
          </group>
        ))}
      </group>

      <group position={[0.72, 0.12, 1.32]} rotation={[0, -0.22, 0]} scale={0.68}>
        <mesh castShadow position={[0, 0.16, 0]}>
          <boxGeometry args={[0.42, 0.34, 0.2]} />
          <meshStandardMaterial color="#d98b61" roughness={0.82} />
        </mesh>
        <mesh position={[0, 0.36, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.15, 0.025, 7, 14, Math.PI]} />
          <meshStandardMaterial color="#704e3d" roughness={0.8} />
        </mesh>
      </group>

      <group position={[-2.95, 0.02, -1.05]} rotation={[0, 0.32, 0]}>
        <mesh castShadow position={[0, 0.46, 0]}>
          <cylinderGeometry args={[0.045, 0.065, 0.92, 8]} />
          <meshStandardMaterial color="#536556" roughness={0.8} />
        </mesh>
        <mesh castShadow position={[0, 0.92, 0]}>
          <sphereGeometry args={[0.17, 12, 9]} />
          <meshStandardMaterial color="#fff0b1" emissive="#f2b96f" emissiveIntensity={0.75} roughness={0.65} />
        </mesh>
        <pointLight position={[0, 0.94, 0]} color="#ffd494" intensity={1.4} distance={3.6} decay={2} />
      </group>
    </>
  );
}

function FloatingPollen({ reducedMotion }: SceneProps) {
  const group = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!group.current || reducedMotion) return;
    group.current.rotation.y = Math.sin(clock.elapsedTime * 0.16) * 0.1;
    group.current.position.y = Math.sin(clock.elapsedTime * 0.45) * 0.045;
  });

  return (
    <group ref={group}>
      <Instances limit={9}>
        <sphereGeometry args={[0.045, 8, 6]} />
        <meshBasicMaterial color="#fff0a6" transparent opacity={0.88} />
        {[
          [-2.2, 1.2, 1.2], [2.35, 1.45, 0.3], [-3.25, 2.0, -1.5],
          [3.5, 1.9, -2.4], [-1.25, 1.5, -3.2], [1.15, 1.15, -1.45],
          [-4.3, 1.65, 2.45], [4.1, 1.3, 2.25], [0.1, 1.78, -4.1],
        ].map((position, index) => <Instance key={index} position={position as [number, number, number]} scale={index % 3 ? 1 : 1.35} />)}
      </Instances>
    </group>
  );
}

function LandingPbao() {
  return (
    <group name="landing-pbao-moment" position={[0.18, 0.54, 2.15]} rotation={[0, 0, 0]} scale={0.67}>
      <PbaoModel animation="idle" />
    </group>
  );
}

function LandingForestScene(props: SceneProps) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  useEffect(() => {
    const portrait = size.height > size.width * 1.25;
    const shortLandscape = size.height < 620 && size.width > size.height;
    if (portrait) {
      camera.position.set(0, 7.4, 12.4);
      camera.lookAt(0, 0.62, -0.1);
    } else if (shortLandscape) {
      camera.position.set(0, 5.6, 11.6);
      camera.lookAt(0, 0.58, -0.75);
    } else {
      camera.position.set(0, 6.1, 10.8);
      camera.lookAt(0, 0.65, -0.5);
    }
    camera.updateProjectionMatrix();
  }, [camera, size.height, size.width]);

  return (
    <>
      <color attach="background" args={["#a9cfa0"]} />
      <fog attach="fog" args={["#c5dbad", 17, 30]} />
      <ambientLight intensity={0.72} />
      <hemisphereLight args={["#fff4c7", "#4e744f", 1.14]} />
      <directionalLight
        castShadow
        position={[-6, 11, 7]}
        intensity={2.25}
        color="#fff0bd"
        shadow-mapSize={[1024, 1024]}
        shadow-camera-far={30}
        shadow-camera-left={-11}
        shadow-camera-right={11}
        shadow-camera-top={11}
        shadow-camera-bottom={-11}
      />
      <pointLight position={[1.1, 2.6, 3.7]} color="#ffd89d" intensity={1.65} distance={6.5} decay={2} />

      <mesh receiveShadow position={[0, -0.18, -0.5]}>
        <cylinderGeometry args={[12, 12.4, 0.36, 64]} />
        <meshStandardMaterial color="#83b569" roughness={1} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[-3.6, 0.006, 2.6]} scale={[2.8, 1.7, 1]}>
        <circleGeometry args={[1, 30]} />
        <meshStandardMaterial color="#79aa62" roughness={1} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[3.85, 0.007, 0.55]} scale={[3, 2.2, 1]}>
        <circleGeometry args={[1, 30]} />
        <meshStandardMaterial color="#8abd6e" roughness={1} />
      </mesh>

      <RiverAndBridge />
      <MeadowDetails />
      <ForestTrees />
      <WelcomeProps />
      <FloatingPollen {...props} />
      <LandingPbao />
    </>
  );
}

export default function LandingForestCanvas({ reducedMotion }: SceneProps) {
  return (
    <Canvas
      shadows
      frameloop={reducedMotion ? "demand" : "always"}
      dpr={[1, 1.45]}
      camera={{ fov: 34, near: 0.1, far: 60, position: [0, 6.1, 10.8] }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.outputColorSpace = SRGBColorSpace;
      }}
      fallback={<div>3D 숲을 표시할 수 없어요.</div>}
    >
      <Suspense fallback={null}>
        <LandingForestScene reducedMotion={reducedMotion} />
      </Suspense>
    </Canvas>
  );
}
