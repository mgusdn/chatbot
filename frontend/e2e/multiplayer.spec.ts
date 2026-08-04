import { expect, test, type Page } from "@playwright/test";

async function mockWorldApi(page: Page) {
  await page.route("http://127.0.0.1:3000/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/memory-rooms/prometheus/memories") {
      await route.fulfill({ json: {
        room: {
          slug: "prometheus",
          title: "프로메테우스 추억방",
          scene_version: 1,
          theme_id: "prometheus-coast",
          revision: 0,
        },
        memories: [],
        next_cursor: null,
      } });
      return;
    }
    if (url.pathname === "/api/commons/today") {
      await route.fulfill({ json: {
        day_key: "2026-08-04",
        traces: [],
        counts: { total: 0, guestbook: 0, installation: 0 },
      } });
      return;
    }
    if (url.pathname === "/api/experiments" && route.request().method() === "POST") {
      await route.fulfill({ status: 201, json: {
        experiment_id: `multiplayer-${Date.now()}`,
        created_at: new Date().toISOString(),
        greetings: { baseline: "안녕하세요." },
        states: {
          baseline: {
            stage: "rapport",
            turn_count: 0,
            filled_slots: [],
            pending_slot: "situation",
            slot_values: {},
          },
        },
      } });
      return;
    }
    if (url.pathname === "/api/speech/health") {
      await route.fulfill({ json: {
        status: "ok",
        stt: { available: false, model: "test", loaded: false, language: "ko", reason: "e2e" },
        tts: { configured: false, connected: null, reason: "e2e" },
      } });
      return;
    }
    if (url.pathname === "/api/health") {
      await route.fulfill({ json: { status: "ok", providers: {} } });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: "not mocked" } });
  });
}

async function enterInterior(page: Page, nickname: string, characterName: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockWorldApi(page);
  await page.goto("/");
  await page.getByTestId("start-button").click();
  await page.getByRole("textbox", { name: /닉네임/ }).fill(nickname);
  await page.getByRole("radio", { name: new RegExp(characterName) }).click();
  await page.getByTestId("confirm-character").click();

  const shell = page.locator(".game-shell");
  await expect(shell).toHaveAttribute("data-game-phase", "exploring-exterior", { timeout: 20_000 });
  await page.waitForTimeout(150);
  const doorPrompt = page.getByTestId("interaction-prompt").filter({ hasText: "문 열기" });
  await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  try {
    await expect(doorPrompt).toHaveCount(1, { timeout: 35_000 });
  } finally {
    await page.keyboard.up("w");
    await page.keyboard.up("Shift");
  }
  await doorPrompt.click();
  await expect(shell).toHaveAttribute("data-scene", "interior", { timeout: 5_000 });
  await expect(shell).toHaveAttribute("data-multiplayer-status", "subscribed", { timeout: 15_000 });
  return shell;
}

test("two browser sessions see each other in the same interior room", async ({ browser, page }) => {
  test.setTimeout(90_000);
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(`first: ${error.message}`));
  secondPage.on("pageerror", (error) => pageErrors.push(`second: ${error.message}`));

  try {
    const [firstShell, secondShell] = await Promise.all([
      enterInterior(page, "첫 번째 산책자", "나비"),
      enterInterior(secondPage, "두 번째 산책자", "송이"),
    ]);
    await expect(firstShell).toHaveAttribute("data-multiplayer-count", /^[1-9]\d*$/, { timeout: 15_000 });
    await expect(secondShell).toHaveAttribute("data-multiplayer-count", /^[1-9]\d*$/, { timeout: 15_000 });

    const peersBeforeClose = Number(await firstShell.getAttribute("data-multiplayer-count"));
    expect(peersBeforeClose).toBeGreaterThanOrEqual(1);
    await secondContext.close();
    await expect.poll(async () => Number(await firstShell.getAttribute("data-multiplayer-count")), {
      timeout: 15_000,
    }).toBeLessThan(peersBeforeClose);
    expect(pageErrors).toEqual([]);
  } finally {
    if (secondContext.pages().length > 0) await secondContext.close();
  }
});
