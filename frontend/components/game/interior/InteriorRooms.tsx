"use client";

import {
  COMMONS_TRACE_ANCHORS,
  INTERIOR_WALL_NORMAL_SHIFT,
} from "@/constants/interiorLayout";
import { PbaoModel } from "../PbaoModel";
import { InteriorAsset } from "./InteriorAsset";

const FURNITURE = "/models/kenney-furniture-kit";
const FOOD = "/models/kenney-food-kit";
const NATURE = "/models/kenney-nature-kit";

function WorkTable({
  position,
  width,
  depth,
  color = "#675448",
}: {
  position: [number, number, number];
  width: number;
  depth: number;
  color?: string;
}) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 0.74, 0]}>
        <boxGeometry args={[width, 0.12, depth]} />
        <meshStandardMaterial color={color} roughness={0.72} />
      </mesh>
      {[-width / 2 + 0.18, width / 2 - 0.18].flatMap((x) => [-depth / 2 + 0.16, depth / 2 - 0.16].map((z) => (
        <mesh key={`${x}-${z}`} position={[x, 0.36, z]}>
          <boxGeometry args={[0.11, 0.72, 0.11]} />
          <meshStandardMaterial color="#4e5552" metalness={0.14} roughness={0.62} />
        </mesh>
      )))}
    </group>
  );
}

function TodayWall() {
  const colors = ["#dfb56e", "#87a58e", "#c98370", "#7d99aa"];
  const wallZ = INTERIOR_WALL_NORMAL_SHIFT.north;
  return (
    <group name="today-wall">
      <mesh castShadow position={[0, 1.55, -7.36 + wallZ]}>
        <boxGeometry args={[5.4, 1.82, 0.1]} />
        <meshStandardMaterial color="#4e5b58" roughness={0.76} />
      </mesh>
      <mesh position={[0, 2.18, -7.29 + wallZ]}>
        <boxGeometry args={[4.75, 0.28, 0.045]} />
        <meshStandardMaterial color="#d6c58f" emissive="#8e794c" emissiveIntensity={0.18} roughness={0.7} />
      </mesh>
      {Array.from({ length: 12 }, (_, index) => {
        const column = index % 4;
        const row = Math.floor(index / 4);
        return (
          <mesh key={index} position={[(column - 1.5) * 0.72, 1.62 + (1 - row) * 0.72, -7.298 + wallZ]}>
            <boxGeometry args={[0.58, 0.42, 0.008]} />
            <meshStandardMaterial color="#65716d" transparent opacity={0.32} roughness={0.92} />
          </mesh>
        );
      })}
      {[1.95, 2.18, 2.41].map((x, index) => (
        <mesh key={x} position={[x, 1.22 + index * 0.24, -7.28 + wallZ]}>
          <boxGeometry args={[0.28, 0.28 + index * 0.14, 0.05]} />
          <meshStandardMaterial color={colors[index]} emissive={colors[index]} emissiveIntensity={0.12} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function InstallationConsole() {
  const pulseColors = ["#d5a65f", "#7da08b", "#c87769", "#8099ad"];
  return (
    <group name="installation-console" position={[8.15 + INTERIOR_WALL_NORMAL_SHIFT.east, 0, 3.15]}>
      <mesh castShadow position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.55, 0.62, 0.24, 24]} />
        <meshStandardMaterial color="#4f5d59" metalness={0.16} roughness={0.66} />
      </mesh>
      <mesh castShadow position={[0, 1.08, 0]}>
        <cylinderGeometry args={[0.055, 0.075, 1.9, 12]} />
        <meshStandardMaterial color="#596965" metalness={0.2} roughness={0.56} />
      </mesh>
      {[0.68, 1.12, 1.58].map((y, index) => (
        <group key={y} position={[0, y, 0]} rotation={[0.35 + index * 0.28, index * 0.8, 0.18]}>
          <mesh castShadow>
            <torusGeometry args={[0.34 + index * 0.06, 0.045, 8, 24]} />
            <meshStandardMaterial
              color={pulseColors[index]}
              emissive={pulseColors[index]}
              emissiveIntensity={0.16}
              metalness={0.08}
              roughness={0.55}
            />
          </mesh>
        </group>
      ))}
      {pulseColors.map((color, index) => {
        const angle = index * Math.PI * 0.5 + 0.35;
        return (
          <mesh key={color} castShadow position={[Math.cos(angle) * 0.45, 0.72 + index * 0.32, Math.sin(angle) * 0.45]}>
            <sphereGeometry args={[0.1 + index * 0.012, 14, 10]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.12} roughness={0.64} />
          </mesh>
        );
      })}
    </group>
  );
}

function InstallationGrid() {
  const traces = COMMONS_TRACE_ANCHORS.filter((anchor) => anchor.kind === "installation-slot");
  const colors = ["#d8b36f", "#7f9f8c", "#c98272", "#839bad"];
  return (
    <group name="visitor-installation-grid">
      {traces.map((anchor, index) => (
        <mesh
          key={anchor.id}
          position={[anchor.position[0], anchor.position[1], anchor.position[2]]}
          rotation={[-Math.PI / 2, 0, index * 0.35]}
        >
          <ringGeometry args={[0.17, 0.28, 20]} />
          <meshStandardMaterial
            color={colors[index % colors.length]}
            emissive={colors[index % colors.length]}
            emissiveIntensity={0.1}
            roughness={0.78}
          />
        </mesh>
      ))}
    </group>
  );
}

function GuestbookCommons() {
  return (
    <group name="guestbook-commons">
      <WorkTable position={[-5.25, 0, 5.25]} width={2.5} depth={1.24} color="#746053" />
      <InteriorAsset url={`${FURNITURE}/chairCushion.glb`} position={[-5.25, 0, 6.25]} rotation={[0, Math.PI, 0]} scale={2} />
      <InteriorAsset url={`${FURNITURE}/chairCushion.glb`} position={[-5.25, 0, 4.25]} scale={2} />
      <InteriorAsset url={`${FURNITURE}/bookcaseOpenLow.glb`} position={[-8.45 + INTERIOR_WALL_NORMAL_SHIFT.west, 0, 4.65]} rotation={[0, Math.PI / 2, 0]} scale={2.25} />
      <InteriorAsset url={`${FURNITURE}/books.glb`} position={[-5.55, 0.82, 5.15]} rotation={[0, 0.15, 0]} scale={1.5} />
      <InteriorAsset url={`${FOOD}/cup-saucer.glb`} position={[-4.8, 0.82, 5.13]} scale={1.25} />
      {[-5.88, -5.48, -5.08].map((x, index) => (
        <mesh key={x} position={[x, 0.835 + index * 0.002, 5.12]} rotation={[-Math.PI / 2, 0, -0.1 + index * 0.08]}>
          <boxGeometry args={[0.32, 0.44, 0.018]} />
          <meshStandardMaterial color={["#eadcbf", "#cbd9c5", "#e0c4b8"][index]} roughness={0.95} />
        </mesh>
      ))}
      <group position={[-7.65, 0, 6.65]}>
        <mesh position={[0, 0.85, 0]}>
          <boxGeometry args={[1.15, 1.5, 0.12]} />
          <meshStandardMaterial color="#53615e" roughness={0.78} />
        </mesh>
        {[0.35, 0.05, -0.25].map((y, index) => (
          <mesh key={y} position={[0, 0.9 + y, 0.07]}>
            <boxGeometry args={[0.78 - index * 0.12, 0.08, 0.025]} />
            <meshStandardMaterial color="#d6c58f" />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function CoworkCafe() {
  return (
    <group name="cowork-cafe">
      <WorkTable position={[5.3, 0, 5.65]} width={2.7} depth={1.36} color="#6e5d51" />
      {[
        [4.55, 6.75, Math.PI], [6.05, 6.75, Math.PI], [4.55, 4.55, 0], [6.05, 4.55, 0],
      ].map(([x, z, rotation], index) => (
        <InteriorAsset key={index} url={`${FURNITURE}/chairRounded.glb`} position={[x, 0, z]} rotation={[0, rotation, 0]} scale={1.9} />
      ))}
      <InteriorAsset url={`${FURNITURE}/loungeSofa.glb`} position={[8.15 + INTERIOR_WALL_NORMAL_SHIFT.east, 0, 5.6]} rotation={[0, -Math.PI / 2, 0]} scale={2.1} />
      <InteriorAsset url={`${FURNITURE}/lampRoundFloor.glb`} position={[8.15 + INTERIOR_WALL_NORMAL_SHIFT.east, 0, 6.9]} scale={1.9} />
      <InteriorAsset url={`${FOOD}/cup-tea.glb`} position={[5, 0.83, 5.62]} scale={1.25} />
      <InteriorAsset url={`${FOOD}/cup-saucer.glb`} position={[5.62, 0.83, 5.66]} scale={1.25} />
    </group>
  );
}

function SharedLibrary() {
  return (
    <group name="shared-library">
      <InteriorAsset url={`${FURNITURE}/bookcaseOpen.glb`} position={[-8.55 + INTERIOR_WALL_NORMAL_SHIFT.west, 0, -0.25]} rotation={[0, Math.PI / 2, 0]} scale={2.35} />
      <InteriorAsset url={`${FURNITURE}/bookcaseClosedDoors.glb`} position={[-6.7, 0, -7.02 + INTERIOR_WALL_NORMAL_SHIFT.north]} scale={2.2} />
      <InteriorAsset url={`${FURNITURE}/bookcaseOpenLow.glb`} position={[-7.55 + INTERIOR_WALL_NORMAL_SHIFT.west, 0, -3.75]} rotation={[0, Math.PI / 2, 0]} scale={2.1} />
      <WorkTable position={[-5.25, 0, -0.15]} width={2.6} depth={1.36} color="#665548" />
      <InteriorAsset url={`${FURNITURE}/chairCushion.glb`} position={[-5.25, 0, 0.9]} rotation={[0, Math.PI, 0]} scale={1.95} />
      <InteriorAsset url={`${FURNITURE}/chairCushion.glb`} position={[-5.25, 0, -1.2]} scale={1.95} />
      <InteriorAsset url={`${FURNITURE}/lampRoundTable.glb`} position={[-5.72, 0.82, -0.12]} scale={1.35} />
      <InteriorAsset url={`${FURNITURE}/books.glb`} position={[-4.88, 0.82, -0.14]} rotation={[0, -0.2, 0]} scale={1.4} />
    </group>
  );
}

function RecoveryAndPlantLab() {
  return (
    <group name="recovery-and-plant-lab">
      <InteriorAsset url={`${FURNITURE}/benchCushion.glb`} position={[8.12 + INTERIOR_WALL_NORMAL_SHIFT.east, 0, -1.25]} rotation={[0, -Math.PI / 2, 0]} scale={2.1} />
      <InteriorAsset url={`${FURNITURE}/tableRound.glb`} position={[5.35, 0, -1.25]} scale={2.25} />
      <InteriorAsset url={`${FURNITURE}/chairRounded.glb`} position={[5.35, 0, -2.45]} scale={1.9} />
      <InteriorAsset url={`${FURNITURE}/pottedPlant.glb`} position={[8.15 + INTERIOR_WALL_NORMAL_SHIFT.east, 0, -2.55]} scale={1.75} />
      <group position={[6.65, 0, -5.45]}>
        <mesh castShadow position={[0, 0.48, 0]}>
          <boxGeometry args={[2, 0.18, 1.44]} />
          <meshStandardMaterial color="#59645d" metalness={0.08} roughness={0.7} />
        </mesh>
        {[-0.7, 0.7].flatMap((x) => [-0.48, 0.48].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, 0.24, z]}>
            <boxGeometry args={[0.1, 0.48, 0.1]} />
            <meshStandardMaterial color="#48504d" metalness={0.12} roughness={0.65} />
          </mesh>
        )))}
      </group>
      <InteriorAsset url={`${NATURE}/pot_small.glb`} position={[6.15, 0.58, -5.5]} scale={2.65} />
      <InteriorAsset url={`${NATURE}/crops_bambooStageB.glb`} position={[6.15, 0.95, -5.5]} scale={1.8} />
      <InteriorAsset url={`${NATURE}/pot_small.glb`} position={[7.05, 0.58, -5.35]} scale={2.35} />
      <InteriorAsset url={`${NATURE}/plant_flatTall.glb`} position={[7.05, 0.9, -5.35]} scale={1.65} />
      <InteriorAsset url={`${FURNITURE}/pottedPlant.glb`} position={[8.25 + INTERIOR_WALL_NORMAL_SHIFT.east, 0, -6.7]} scale={1.9} />
    </group>
  );
}

function PbaoResearchBay() {
  return (
    <group name="pbao-research-bay">
      <TodayWall />
      <InteriorAsset url={`${FURNITURE}/rugRounded.glb`} position={[0, 0.025, -5.15]} scale={[5.2, 1, 3.15]} castShadow={false} />
      <WorkTable position={[0, 0, -5.1]} width={3.3} depth={1} color="#5e5148" />
      <group position={[0, 0.76, -6.25]} scale={0.92}>
        <PbaoModel />
      </group>
      <InteriorAsset url={`${FURNITURE}/chairRounded.glb`} position={[-2.75, 0, -4]} rotation={[0, 0.45, 0]} scale={1.85} />
      <InteriorAsset url={`${FURNITURE}/chairRounded.glb`} position={[2.75, 0, -4]} rotation={[0, -0.45, 0]} scale={1.85} />
      <InteriorAsset url={`${FURNITURE}/lampRoundTable.glb`} position={[-0.72, 0.82, -5.08]} scale={1.35} />
      <InteriorAsset url={`${FURNITURE}/books.glb`} position={[0.55, 0.82, -5.06]} rotation={[0, -0.18, 0]} scale={1.35} />
      <InteriorAsset url={`${FOOD}/cup-tea.glb`} position={[0.94, 0.82, -5.03]} scale={1.2} />
    </group>
  );
}

export function InteriorRooms() {
  return (
    <>
      <InstallationGrid />
      <InstallationConsole />
      <GuestbookCommons />
      <CoworkCafe />
      <SharedLibrary />
      <RecoveryAndPlantLab />
      <PbaoResearchBay />
    </>
  );
}
