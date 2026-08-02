"use client";

import {
  INTERIOR_FURNITURE_LAYOUT,
  INTERIOR_WALL_NORMAL_SHIFT,
} from "@/constants/interiorLayout";
import { PbaoModel } from "../PbaoModel";
import { InteriorAsset } from "./InteriorAsset";

const FURNITURE = "/models/kenney-furniture-kit";
const FOOD = "/models/kenney-food-kit";
const NATURE = "/models/kenney-nature-kit";
const LAYOUT = INTERIOR_FURNITURE_LAYOUT;

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

function GuestbookCommons() {
  return (
    <group name="guestbook-commons">
      <InteriorAsset
        url={`${FURNITURE}/rugRounded.glb`}
        position={[
          LAYOUT.guestbookWorktable.position[0],
          0.025,
          LAYOUT.guestbookWorktable.position[2] - 0.08,
        ]}
        scale={[4.2, 1, 2.8]}
        castShadow={false}
      />
      <WorkTable position={LAYOUT.guestbookWorktable.position} width={2.5} depth={1.24} color="#746053" />
      <InteriorAsset
        url={`${FURNITURE}/chairCushion.glb`}
        position={LAYOUT.guestbookChairNorth.position}
        scale={4}
      />
      <InteriorAsset
        url={`${FURNITURE}/bookcaseOpenLow.glb`}
        position={LAYOUT.guestbookLowShelf.position}
        rotation={[0, Math.PI / 2, 0]}
        scale={2.25}
      />
      <InteriorAsset url={`${FURNITURE}/books.glb`} position={[-5.9, 0.82, 5.2]} rotation={[0, 0.15, 0]} scale={1.5} />
      <InteriorAsset url={`${FOOD}/cup-saucer.glb`} position={[-5.15, 0.82, 5.18]} scale={1.25} />
      {[-6.23, -5.83, -5.43].map((x, index) => (
        <mesh key={x} position={[x, 0.835 + index * 0.002, 5.17]} rotation={[-Math.PI / 2, 0, -0.1 + index * 0.08]}>
          <boxGeometry args={[0.32, 0.44, 0.018]} />
          <meshStandardMaterial color={["#eadcbf", "#cbd9c5", "#e0c4b8"][index]} roughness={0.95} />
        </mesh>
      ))}
      <group position={LAYOUT.guestbookNoticeBoard.position}>
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

function RecoveryAndPlantLab() {
  return (
    <group name="recovery-and-plant-lab">
      <group position={LAYOUT.plantLabIsland.position}>
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
      <InteriorAsset url={`${NATURE}/pot_small.glb`} position={[6.1, 0.58, -5.55]} scale={2.65} />
      <InteriorAsset url={`${NATURE}/crops_bambooStageB.glb`} position={[6.1, 0.95, -5.55]} scale={1.8} />
      <InteriorAsset url={`${NATURE}/pot_small.glb`} position={[7, 0.58, -5.4]} scale={2.35} />
      <InteriorAsset url={`${NATURE}/plant_flatTall.glb`} position={[7, 0.9, -5.4]} scale={1.65} />
    </group>
  );
}

function PbaoResearchBay() {
  return (
    <group name="pbao-research-bay">
      <TodayWall />
      <InteriorAsset url={`${FURNITURE}/rugRounded.glb`} position={[0, 0.025, -5.15]} scale={[5.2, 1, 3.15]} castShadow={false} />
      <WorkTable position={LAYOUT.pbaoDesk.position} width={3.3} depth={1} color="#5e5148" />
      <group position={[0, 0.76, -6.25]} scale={0.92}>
        <PbaoModel />
      </group>
      <InteriorAsset url={`${FURNITURE}/chairRounded.glb`} position={LAYOUT.pbaoChairWest.position} rotation={[0, 0.45, 0]} scale={1.85} />
      <InteriorAsset url={`${FURNITURE}/lampRoundTable.glb`} position={[-0.72, 0.82, -5.08]} scale={1.35} />
      <InteriorAsset url={`${FURNITURE}/books.glb`} position={[0.55, 0.82, -5.06]} rotation={[0, -0.18, 0]} scale={1.35} />
      <InteriorAsset url={`${FOOD}/cup-tea.glb`} position={[0.94, 0.82, -5.03]} scale={1.2} />
    </group>
  );
}

export function InteriorRooms() {
  return (
    <>
      <GuestbookCommons />
      <RecoveryAndPlantLab />
      <PbaoResearchBay />
    </>
  );
}
