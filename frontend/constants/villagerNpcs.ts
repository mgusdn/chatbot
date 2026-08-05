export type VillagerNpcDefinition = {
  id: string;
  spriteUrl: string;
  spriteAlt: string;
  position: readonly [number, number, number];
  line: string;
};

/** How close the player needs to walk for a villager's speech bubble to appear. */
export const NPC_SPEECH_RADIUS = 2.2;

/** Sprite height in world units; width follows each image's natural aspect ratio. */
export const NPC_SPRITE_HEIGHT = 2.4;

/**
 * Fixed idle villagers scattered along the counseling house's west/east side
 * walls only (see constants/interiorLayout.ts for INTERIOR_SIZE/
 * INTERIOR_WALLS) — never the north/south walls. Positions alternate between
 * an "outer" x (2.05m in from the wall centerline) and an "inner" x (3.5m
 * in) per wall, so the row reads as a natural zig-zag instead of a straight
 * line. All five now sit much closer to the entrance (+z, see
 * WORLD_CONFIG.interiorSpawn) than the back of the room, since they used to
 * bunch up near the back (-z) wall. West-wall villagers stay below z=3
 * (below guestbookChairNorth's z-span start at 3.39) so the zig-zag never
 * steps into the guestbook-commons writing cluster; the east wall has no
 * furniture left to avoid.
 */
export const VILLAGER_NPCS: readonly VillagerNpcDefinition[] = [
  {
    id: "npc-1",
    spriteUrl: "/images/characters/npc-duck.png",
    spriteAlt: "오리 주민",
    // West wall, outer, back third.
    position: [-8.75, 0, -3.5],
    line: "다들 왕사랑!",
  },
  {
    id: "npc-2",
    spriteUrl: "/images/characters/npc-girl.png",
    spriteAlt: "소녀 주민",
    // West wall, outer, front third.
    position: [-8.75, 0, 2.8],
    line: "당신을 좋아하지 않을 사람은 없어요.",
  },
  {
    id: "npc-3",
    spriteUrl: "/images/characters/npc-dog.png",
    spriteAlt: "기타 치는 강아지 주민",
    // West wall, inner (zig-zag step), middle — off the guestbook-commons corner.
    position: [-7.3, 0, -0.5],
    line: "프메는 2021년 5월 13일에 창립되었어요. 현재 (9기) 대표는 홍지연이고 부대표는 조현우래요.",
  },
  {
    id: "npc-4",
    spriteUrl: "/images/characters/npc-hamster.png",
    spriteAlt: "햄스터 주민",
    // East wall, outer, back half.
    position: [8.75, 0, -1.5],
    line: "세상에 쉬운 것은 없지만 못할 것도 없잖아",
  },
  {
    id: "npc-5",
    spriteUrl: "/images/characters/npc-deer.png",
    spriteAlt: "사슴 주민",
    // East wall, inner (zig-zag step), front half.
    position: [7.3, 0, 4],
    line: "데모데이에 온 걸 환영해! 행복하게 즐기길!",
  },
] as const;
