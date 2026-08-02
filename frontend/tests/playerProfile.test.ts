import { describe, expect, it } from "vitest";
import {
  MIGRATED_PROFILE_NICKNAME,
  PLAYER_PROFILE_KEY,
  normalizeNickname,
  readPlayerProfile,
  validateNickname,
  writePlayerProfile,
} from "@/lib/storage/playerProfile";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("player profile", () => {
  it("stores the nickname and character as a v2 profile without counseling content", () => {
    const storage = memoryStorage();
    const profile = writePlayerProfile(storage, "cat", " 구름  산책자 ");

    expect(profile).toMatchObject({ schemaVersion: 2, characterId: "cat", nickname: "구름 산책자" });
    expect(readPlayerProfile(storage)).toMatchObject({ schemaVersion: 2, characterId: "cat", nickname: "구름 산책자" });
    expect(storage.getItem(PLAYER_PROFILE_KEY)).not.toContain("transcript");
  });

  it("migrates a valid v1 character profile with a safe default nickname", () => {
    const storage = memoryStorage();
    storage.setItem(PLAYER_PROFILE_KEY, JSON.stringify({
      schemaVersion: 1,
      characterId: "cat",
      selectedAt: "2026-07-20T12:00:00.000Z",
    }));

    expect(readPlayerProfile(storage)).toEqual({
      schemaVersion: 2,
      characterId: "cat",
      nickname: MIGRATED_PROFILE_NICKNAME,
      selectedAt: "2026-07-20T12:00:00.000Z",
    });
  });

  it("keeps a retired Master profile readable so its nickname can migrate to Yeoul", () => {
    const storage = memoryStorage();
    storage.setItem(PLAYER_PROFILE_KEY, JSON.stringify({
      schemaVersion: 2,
      characterId: "rabbit",
      nickname: "차마시는마음",
      selectedAt: "2026-07-21T12:00:00.000Z",
    }));

    expect(readPlayerProfile(storage)).toMatchObject({
      schemaVersion: 2,
      characterId: "rabbit",
      nickname: "차마시는마음",
    });
  });

  it("rejects invalid versions, ids, and nicknames", () => {
    const storage = memoryStorage();
    storage.setItem(PLAYER_PROFILE_KEY, JSON.stringify({ schemaVersion: 3, characterId: "sprout", nickname: "새싹" }));
    expect(readPlayerProfile(storage)).toBeNull();

    storage.setItem(PLAYER_PROFILE_KEY, JSON.stringify({ schemaVersion: 2, characterId: "pbao", nickname: "프바오" }));
    expect(readPlayerProfile(storage)).toBeNull();

    storage.setItem(PLAYER_PROFILE_KEY, JSON.stringify({ schemaVersion: 2, characterId: "cloud", nickname: "   " }));
    expect(readPlayerProfile(storage)).toBeNull();
    expect(() => writePlayerProfile(storage, "cat", "<구름>")).toThrow("사용할 수 없는 문자");
  });

  it("normalizes spacing and enforces the ten-character limit", () => {
    expect(normalizeNickname("  마음   산책자  ")).toBe("마음 산책자");
    expect(validateNickname("마음산책자")).toBeNull();
    expect(validateNickname("")).toBe("닉네임을 입력해주세요.");
    expect(validateNickname("가나다라마바사아자차카")).toContain("10자");
  });
});
