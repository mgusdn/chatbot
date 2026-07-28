import { expect, test, type Page, type TestInfo } from "@playwright/test";

const emptyState = {
  stage: "rapport",
  turn_count: 0,
  filled_slots: [],
  pending_slot: "situation",
  slot_values: {},
};

async function mockCounselingApi(page: Page) {
  let completed = false;
  let safetyBypass = false;
  let commonsTraceCounter = 0;
  let memoryCounter = 0;
  const commonsTraces: Array<Record<string, unknown>> = [];
  const roomMemories: Array<Record<string, unknown>> = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/api/memory-rooms/prometheus/memories" && method === "GET") {
      await route.fulfill({ json: {
        room: { slug: "prometheus", title: "프로메테우스 추억방", scene_version: 1, theme_id: "prometheus-coast", revision: roomMemories.length },
        memories: roomMemories,
        next_cursor: null,
      } });
      return;
    }
    if (url.pathname === "/api/memory-rooms/prometheus/memories" && method === "POST") {
      const body = route.request().postDataJSON() as {
        kind: string;
        body?: string;
        design?: {
          version: number;
          layers: Array<{ type: string; text?: string }>;
        };
        emotion?: string | null;
        card_style: string;
        author_alias?: string | null;
        placement: Record<string, unknown>;
      };
      const accessibleBody = body.body || body.design?.layers
        .filter((layer) => layer.type === "text")
        .map((layer) => layer.text || "")
        .join(" ")
        .trim() || "";
      memoryCounter += 1;
      const memory = {
        id: `memory-${memoryCounter}`,
        kind: body.kind,
        body: accessibleBody,
        design: body.design || null,
        emotion: body.emotion || null,
        card_style: body.card_style,
        author_alias: body.author_alias || "다정한 산책자",
        reaction_count: 0,
        version: 1,
        created_at: "2026-07-22T12:00:00Z",
        updated_at: "2026-07-22T12:00:00Z",
        placement: { ...body.placement, version: 1 },
      };
      roomMemories.unshift(memory);
      await route.fulfill({ status: 201, json: { memory, ownership_token: `memory-owner-${memoryCounter}-1234567890` } });
      return;
    }
    const relocationMatch = url.pathname.match(
      /^\/api\/memory-rooms\/prometheus\/memories\/([^/]+)\/relocations$/,
    );
    if (relocationMatch && method === "POST") {
      const memory = roomMemories.find((candidate) => candidate.id === relocationMatch[1]);
      if (!memory) {
        await route.fulfill({ status: 404, json: { detail: "not found" } });
        return;
      }
      const body = route.request().postDataJSON() as {
        expected_version: number;
        surface_id: string;
        u: number;
        v: number;
        rotation_deg: number;
        scale: number;
      };
      const placement = memory.placement as Record<string, unknown>;
      if (Number(placement.version) !== body.expected_version) {
        await route.fulfill({
          status: 409,
          json: { detail: { message: "version conflict", current_version: placement.version } },
        });
        return;
      }
      memory.placement = {
        surface_id: body.surface_id,
        u: body.u,
        v: body.v,
        rotation_deg: body.rotation_deg,
        scale: body.scale,
        z_index: 1,
        version: body.expected_version + 1,
      };
      memory.version = Number(memory.version) + 1;
      await route.fulfill({ status: 200, json: memory });
      return;
    }
    if (url.pathname === "/api/commons/today" && method === "GET") {
      await route.fulfill({ json: {
        day_key: "2026-07-20",
        traces: commonsTraces,
        counts: {
          total: commonsTraces.length,
          guestbook: commonsTraces.filter((trace) => trace.kind === "guestbook").length,
          installation: commonsTraces.filter((trace) => trace.kind === "installation").length,
        },
      } });
      return;
    }
    if (["/api/commons/guestbook", "/api/commons/installations"].includes(url.pathname) && method === "POST") {
      const body = route.request().postDataJSON() as { message?: string; object_kind?: string };
      const kind = url.pathname.endsWith("guestbook") ? "guestbook" : "installation";
      commonsTraceCounter += 1;
      const trace = {
        id: `commons-${commonsTraceCounter}`,
        day_key: "2026-07-20",
        kind,
        anchor_key: kind === "guestbook" ? "today-wall" : `installation-${String(commonsTraceCounter).padStart(2, "0")}`,
        object_kind: kind === "installation" ? body.object_kind : null,
        message: body.message || null,
        alias: "오늘의 다정한 수달",
        created_bucket: "afternoon",
        reaction_count: 0,
      };
      commonsTraces.unshift(trace);
      await route.fulfill({ status: 201, json: { trace, ownership_token: `owner-token-${commonsTraceCounter}-1234567890` } });
      return;
    }
    const commonsTraceMatch = url.pathname.match(/^\/api\/commons\/traces\/([^/]+)(?:\/(reactions|reports))?$/);
    if (commonsTraceMatch) {
      const trace = commonsTraces.find((candidate) => candidate.id === commonsTraceMatch[1]);
      if (!trace) {
        await route.fulfill({ status: 404, json: { detail: "not found" } });
        return;
      }
      if (method === "DELETE") {
        commonsTraces.splice(commonsTraces.indexOf(trace), 1);
        await route.fulfill({ status: 204 });
        return;
      }
      if (commonsTraceMatch[2] === "reactions") {
        trace.reaction_count = Number(trace.reaction_count || 0) + 1;
        await route.fulfill({ json: { trace_id: trace.id, reaction_count: trace.reaction_count } });
        return;
      }
      if (commonsTraceMatch[2] === "reports") {
        await route.fulfill({ status: 202, json: { trace_id: trace.id, reported: true } });
        return;
      }
    }
    if (url.pathname === "/api/health") {
      await route.fulfill({ json: {
        status: "ok",
        providers: {
          gemini: {
            configured: true,
            connected: true,
            resolved_model: "test-gemini",
            profiles: {
              baseline: { api_route: "primary", thinking_level: "low" },
              optimized: {
                response_api_route: "primary",
                response_thinking_level: "minimal",
                analyzer_api_route: "analyzer",
                analyzer_thinking_level: "low",
                analyzer_api_separate: true,
              },
            },
          },
        },
      } });
      return;
    }
    if (url.pathname === "/api/speech/health") {
      await route.fulfill({ json: {
        status: "ok",
        stt: { available: true, model: "small", loaded: true, language: "ko", reason: null },
        tts: { configured: false, connected: null, reason: "테스트에서 TTS 비활성화" },
      } });
      return;
    }
    if (url.pathname === "/api/experiments" && route.request().method() === "POST") {
      await route.fulfill({ status: 201, json: { experiment_id: "e2e-session", created_at: new Date().toISOString(), greetings: { baseline: "안녕하세요. 오늘 마음은 어떤가요?", optimized: "안녕하세요. 오늘 마음은 어떤가요?" }, states: { baseline: emptyState, optimized: emptyState } } });
      return;
    }
    if (url.pathname.endsWith("/turns")) {
      const message = (route.request().postDataJSON() as { message?: string }).message || "";
      completed = message.includes("상담을 마무리");
      safetyBypass = message.includes("긴급 도움");
      if (message.includes("느린 상담")) await new Promise((resolve) => setTimeout(resolve, 5_000));
      await route.fulfill({ json: { experiment_id: "e2e-session", comparison_id: "comparison", results: { optimized: safetyBypass ? {
        run_id: "safety-run",
        status: "ok",
        message: "지금은 안전이 가장 중요해요. 즉시 112·119 또는 가까운 응급실에 도움을 요청해 주세요.",
        safety_bypass: true,
        metrics: { total_ms: 120 },
        state: { ...emptyState, stage: "done", turn_count: 2, pending_slot: null },
      } : completed ? {
        run_id: "completed-run",
        status: "ok",
        message: "## 🧊 마음 정리 리포트\n\n### 1. 지금의 마음\n- **충분히 애써 온 마음**을 발견했어요.\n\n### 2. 다음 걸음\n- 오늘은 가장 작은 일 하나부터 시작해 보세요.",
        safety_bypass: false,
        metrics: { total_ms: 654 },
        state: { ...emptyState, stage: "done", turn_count: 12, filled_slots: ["situation", "emotion", "goal"], pending_slot: null, report_fallback: false },
      } : {
        status: "ok",
        message: "해야 할 일이 많아 마음이 무거웠군요. 가장 급한 일 하나부터 같이 살펴볼까요?",
        safety_bypass: false,
        metrics: { total_ms: 321 },
        state: { ...emptyState, stage: "loop", turn_count: 1, filled_slots: ["situation", "emotion"], pending_slot: "thought" },
      } } } });
      return;
    }
    if (url.pathname.endsWith("/demo-state")) {
      const done = completed || safetyBypass;
      await route.fulfill({ json: { ...emptyState, stage: done ? "done" : "loop", turn_count: completed ? 12 : safetyBypass ? 2 : 1, filled_slots: ["situation", "emotion"], pending_slot: done ? null : "thought", slot_values: { situation: ["해야 할 일이 많음"], emotion: ["마음이 무거움"] } } });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: "not mocked" } });
  });
}

const MOVE_VECTOR: Record<string, [number, number]> = {
  w: [0, -1],
  a: [-1, 0],
  s: [0, 1],
  d: [1, 0],
};

async function beginMove(page: Page, key: string) {
  const joystick = page.getByRole("application", { name: "이동 조이스틱" });
  if (await joystick.isVisible()) {
    const bounds = await joystick.boundingBox();
    if (!bounds) throw new Error("mobile joystick bounds are unavailable");
    const [x, y] = MOVE_VECTOR[key];
    await page.mouse.move(bounds.x + bounds.width / 2 + x * 40, bounds.y + bounds.height / 2 + y * 40);
    await page.mouse.down();
    return async () => { await page.mouse.up(); };
  }

  await page.keyboard.down("Shift");
  await page.keyboard.down(key);
  return async () => {
    await page.keyboard.up(key);
    await page.keyboard.up("Shift");
  };
}

async function moveFor(page: Page, key: string, durationMs: number) {
  const stop = await beginMove(page, key);
  try {
    await page.waitForTimeout(durationMs);
  } finally {
    await stop();
  }
}

async function walkUntilPrompt(page: Page, expectedText: string, timeoutMs: number, key = "w") {
  const prompt = page.getByTestId("interaction-prompt").filter({ hasText: expectedText });
  const stop = await beginMove(page, key);
  try {
    await expect(prompt).toHaveCount(1, { timeout: timeoutMs });
  } finally {
    await stop();
  }
}

async function interact(page: Page, testInfo: TestInfo) {
  const button = testInfo.project.name.startsWith("mobile")
    ? page.getByTestId("mobile-interaction-button")
    : page.getByTestId("interaction-prompt");
  await expect(button).toBeEnabled();
  await button.click();
}

async function enterCounselingRoom(page: Page, testInfo: TestInfo) {
  const shell = await enterCommons(page, testInfo);
  await walkUntilPrompt(page, "말 걸기", 20_000);
  await interact(page, testInfo);
  await expect(page.getByTestId("counseling-screen")).toBeVisible({ timeout: 5_000 });
  return shell;
}

async function enterCommons(page: Page, testInfo: TestInfo) {
  await page.getByTestId("start-button").click();
  await expect(page.getByRole("radiogroup", { name: "플레이어 캐릭터 선택" })).toBeVisible();
  await page.getByRole("textbox", { name: /닉네임/ }).fill("마음산책자");
  await page.getByRole("radio", { name: /구름/ }).click();
  await page.getByTestId("confirm-character").click();

  const shell = page.locator(".game-shell");
  await expect(shell).toHaveAttribute("data-game-phase", "exploring-exterior", { timeout: 20_000 });
  // The phase changes before PlayerController's passive keyboard listener has
  // necessarily rebound. Give that handoff one frame so the first held W is
  // not lost on fast desktop workers.
  await page.waitForTimeout(150);
  await walkUntilPrompt(page, "문 열기", 35_000);
  await interact(page, testInfo);
  await expect(shell).toHaveAttribute("data-scene", "interior", { timeout: 5_000 });
  await expect(page.getByTestId("interaction-prompt")).toContainText("밖으로 나가기", { timeout: 10_000 });
  return shell;
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockCounselingApi(page);
  await page.goto("/");
});

test("landing introduces Pbao and onboarding offers eleven residents with a nickname", async ({ page }) => {
  const heading = page.getByRole("heading", { name: "풀어봐요, 프바오와 고민의 숲." });
  const startButton = page.getByTestId("start-button");
  await expect(heading).toBeVisible();
  await expect(startButton).toBeVisible();

  const viewport = page.viewportSize();
  const headingBox = await heading.boundingBox();
  const startBox = await startButton.boundingBox();
  expect(viewport).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(startBox).not.toBeNull();
  if (viewport && headingBox && startBox) {
    for (const box of [headingBox, startBox]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    const overlaps = !(
      headingBox.x + headingBox.width <= startBox.x
      || startBox.x + startBox.width <= headingBox.x
      || headingBox.y + headingBox.height <= startBox.y
      || startBox.y + startBox.height <= headingBox.y
    );
    expect(overlaps).toBe(false);
  }

  await page.getByTestId("start-button").click();

  const residents = page.getByRole("radiogroup", { name: "플레이어 캐릭터 선택" }).getByRole("radio");
  await expect(residents).toHaveCount(11);
  await expect(page.getByTestId("confirm-character")).toBeDisabled();

  await page.getByRole("textbox", { name: /닉네임/ }).fill("초록마음");
  await page.getByRole("radio", { name: /나비/ }).click();
  await expect(page.getByText("초록마음", { exact: true })).toBeVisible();
  await expect(page.getByTestId("confirm-character")).toBeEnabled();
});

test("choose a 3D character, reach Pbao, counsel, and return", async ({ page }, testInfo) => {
  const shell = await enterCounselingRoom(page, testInfo);
  await expect(shell).toHaveAttribute("data-player-character", "cloud");
  const counselingScreen = page.getByTestId("counseling-screen");
  await expect(counselingScreen.getByText("연결됨", { exact: true })).toBeVisible();
  await expect(counselingScreen.getByText("B · 판단 API 분리", { exact: true })).toBeVisible();
  await expect(counselingScreen.getByText("개선 Gemini · minimal", { exact: true })).toBeVisible();
  await expect(counselingScreen.locator(".stage-meta b")).toHaveText("개선 Gemini · minimal · 판단 API 분리");
  await expect(counselingScreen.getByRole("button", { name: "음성 입력" })).toBeEnabled();
  await expect(counselingScreen.getByRole("button", { name: "음성 답변 꺼짐" })).toBeDisabled();

  const composer = page.getByPlaceholder("예: 해야 할 일이 많은데 자꾸 미루게 돼서 스스로에게 답답해요.");
  await composer.fill("해야 할 일이 많아서 마음이 무거워요.");
  await page.getByRole("button", { name: "minimal 흐름으로 보내기" }).click();
  await expect(page.locator(".speech-bubble").getByText("해야 할 일이 많아 마음이 무거웠군요. 가장 급한 일 하나부터 같이 살펴볼까요?")).toBeVisible();
  await expect(page.getByText("해야 할 일이 많음")).toBeVisible();

  await page.getByRole("button", { name: "상담소로 돌아가기" }).click();
  await expect(shell).toHaveAttribute("data-game-phase", /^(exploring-interior|interaction-ready)$/, { timeout: 5_000 });
  await expect(page.getByTestId("counseling-screen")).toBeHidden();
  await expect(page.getByTestId("counsel-report-overlay")).toHaveCount(0);
  await expect(shell).toHaveAttribute("data-player-character", "cloud");
});

test("completed counseling returns to Pbao, reveals the report, then resumes exploration", async ({ page }, testInfo) => {
  const shell = await enterCounselingRoom(page, testInfo);
  const composer = page.getByPlaceholder("예: 해야 할 일이 많은데 자꾸 미루게 돼서 스스로에게 답답해요.");
  await composer.fill("이제 상담을 마무리하고 싶어요.");
  await page.getByRole("button", { name: "minimal 흐름으로 보내기" }).click();

  await expect(shell).toHaveAttribute("data-game-phase", "report-active", { timeout: 5_000 });
  await expect(page.getByTestId("counseling-screen")).toBeHidden();
  const report = page.getByTestId("counsel-report-overlay");
  await expect(report).toBeVisible();
  await expect(report.getByRole("heading", { name: "마음 정리가 도착했어요" })).toBeVisible();
  await expect(report.getByText("충분히 애써 온 마음")).toBeVisible();

  await report.getByRole("button", { name: "확인하고 계속 둘러보기" }).click();
  await expect(report).toHaveCount(0);
  await expect(shell).toHaveAttribute("data-game-phase", /^(exploring-interior|interaction-ready)$/, { timeout: 5_000 });
  await expect(shell).toHaveAttribute("data-scene", "interior");
});

test("a safety response stays in counseling and never opens the completion report", async ({ page }, testInfo) => {
  const shell = await enterCounselingRoom(page, testInfo);
  const composer = page.getByPlaceholder("예: 해야 할 일이 많은데 자꾸 미루게 돼서 스스로에게 답답해요.");
  await composer.fill("지금 긴급 도움이 필요해요.");
  await page.getByRole("button", { name: "minimal 흐름으로 보내기" }).click();

  await expect(shell).toHaveAttribute("data-game-phase", "counsel-active");
  await expect(page.getByTestId("counseling-screen")).toBeVisible();
  await expect(page.locator(".speech-bubble").getByText(/112·119/)).toBeVisible();
  await expect(page.getByTestId("counsel-report-overlay")).toHaveCount(0);
});

test("closing a pending completion cannot leak a stale report into the next visit", async ({ page }, testInfo) => {
  const shell = await enterCounselingRoom(page, testInfo);
  const composer = page.getByPlaceholder("예: 해야 할 일이 많은데 자꾸 미루게 돼서 스스로에게 답답해요.");
  await composer.fill("느린 상담을 마무리하고 싶어요.");
  await page.getByRole("button", { name: "minimal 흐름으로 보내기" }).click();
  await page.getByRole("button", { name: "상담소로 돌아가기" }).click();

  await expect(shell).toHaveAttribute("data-game-phase", /^(exploring-interior|interaction-ready)$/, { timeout: 5_000 });
  await expect(page.getByTestId("interaction-prompt")).toContainText("말 걸기", { timeout: 5_000 });
  await interact(page, testInfo);
  await expect(page.getByTestId("counseling-screen")).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(5_500);
  await expect(shell).toHaveAttribute("data-game-phase", "counsel-active");
  await expect(page.getByTestId("counsel-report-overlay")).toHaveCount(0);
  await expect(page.locator(".speech-bubble")).not.toContainText("마음 정리 리포트");
});

test("stored character is preselected but still requires confirmation", async ({ page }) => {
  await page.getByTestId("start-button").click();
  await page.getByRole("textbox", { name: /닉네임/ }).fill("다시온마음");
  await page.getByRole("radio", { name: /도토리/ }).click();
  await page.getByTestId("confirm-character").click();
  await page.reload();
  await page.getByTestId("start-button").click();
  await expect(page.getByRole("radio", { name: /도토리/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("textbox", { name: /닉네임/ })).toHaveValue("다시온마음");
  await expect(page.getByTestId("confirm-character")).toBeVisible();
});

test("visitors can place a persistent memory and install a shared object", async ({ page }, testInfo) => {
  const shell = await enterCommons(page, testInfo);

  await walkUntilPrompt(page, "프로메테우스 추억방 열기", 15_000, "a");
  await interact(page, testInfo);
  await expect(shell).toHaveAttribute("data-commons-station", "guestbook");
  const editor = page.getByTestId("guestbook-letter-editor-modal");
  await expect(editor.getByRole("heading", { name: "방명록 교환권 꾸미기" })).toBeVisible();
  await editor.getByPlaceholder("마음을 적어주세요.").fill("서로의 이야기를 천천히 들었던 밤");
  await editor.getByRole("button", { name: "하트 스티커 추가" }).click();
  await editor.getByRole("button", { name: "꾸미기 완료" }).click();
  await expect(shell).toHaveAttribute("data-commons-station", "");
  await expect(shell).toHaveAttribute("data-guestbook-voucher", "armed");
  await expect(page.getByTestId("guestbook-voucher-hud")).toContainText("Q 놓기");
  // The Canvas unpauses and PlayerController rebinds its keyboard listener in
  // passive effects after the editor disappears. Do not drop the first route
  // key into that one-frame handoff.
  await page.waitForTimeout(150);

  // The chair blocks a straight route north from the worktable. Step into the
  // center aisle first, then walk inward so the full letter clears the wall,
  // entrance strip, and furniture collider.
  await moveFor(page, "d", testInfo.project.name.startsWith("mobile") ? 900 : 550);
  await moveFor(page, "w", testInfo.project.name.startsWith("mobile") ? 1_050 : 650);
  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByTestId("mobile-guestbook-place").click();
  } else {
    await page.keyboard.press("r");
    await page.keyboard.press("q");
  }
  await expect(shell).toHaveAttribute("data-guestbook-voucher", "empty");
  await expect(shell).toHaveAttribute("data-selected-memory", "memory-1");
  await expect(editor).toHaveCount(0);

  if (testInfo.project.name.startsWith("mobile")) {
    await page.reload();
    await enterCommons(page, testInfo);
  } else {
    await moveFor(page, "s", 900);
    await walkUntilPrompt(page, "밖으로 나가기", 8_000, "d");
  }
  await walkUntilPrompt(page, "말 걸기", 15_000);
  // Desktop movement holds Shift (run speed), while the touch joystick uses
  // walk speed. Land both routes in the same open gallery aisle.
  await moveFor(page, "s", testInfo.project.name.startsWith("mobile") ? 2_200 : 900);
  if (testInfo.project.name.startsWith("mobile")) {
    await walkUntilPrompt(page, "흔적 설치하기", 12_000, "d");
  } else {
    // Reach the east edge first, then sweep south through the installation
    // interaction radius. This stays stable even when a collider nudges the
    // long horizontal run a little north or south.
    await moveFor(page, "d", 3_000);
    await walkUntilPrompt(page, "흔적 설치하기", 8_000, "s");
  }
  await interact(page, testInfo);
  await expect(shell).toHaveAttribute("data-commons-station", "installation");
  const installationPanel = page.getByTestId("commons-panel");
  await expect(installationPanel.getByRole("heading", { name: "오늘의 설치 갤러리" })).toBeVisible();
  await installationPanel.getByRole("radio", { name: /책/ }).click();
  await installationPanel.getByRole("textbox", { name: "남길 메시지" }).fill("다음 사람을 위한 한 권의 여유");
  await installationPanel.getByRole("button", { name: "흔적 남기기" }).click();
  const installedTraces = installationPanel.getByRole("list", { name: "오늘 남겨진 흔적" });
  await expect(installedTraces.getByText("다음 사람을 위한 한 권의 여유")).toBeVisible();
  await expect(installedTraces.getByText("책", { exact: true })).toBeVisible();
});
