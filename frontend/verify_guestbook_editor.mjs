import { chromium } from "playwright";

async function beginMove(page, key) {
  await page.keyboard.down(key);
  return async () => { await page.keyboard.up(key); };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await page.goto("http://127.0.0.1:3000", { waitUntil: "networkidle" });

await page.getByTestId("start-button").click();
await page.getByRole("radiogroup", { name: "플레이어 캐릭터 선택" }).waitFor();
await page.getByRole("textbox", { name: /닉네임/ }).fill("마음산책자");
await page.getByRole("radio", { name: /나비/ }).click();
await page.getByTestId("confirm-character").click();

await page.waitForFunction(() => document.querySelector(".game-shell")?.getAttribute("data-game-phase") === "exploring-exterior", { timeout: 20000 });
await page.waitForTimeout(300);

let stop = await beginMove(page, "w");
await page.waitForFunction(() => {
  const el = document.querySelector('[data-testid="interaction-prompt"]');
  return el && el.textContent && el.textContent.includes("문 열기");
}, { timeout: 35000 });
await stop();
await page.getByTestId("interaction-prompt").click();
await page.waitForFunction(() => document.querySelector(".game-shell")?.getAttribute("data-scene") === "interior", { timeout: 5000 });
await page.waitForTimeout(300);

// Walk to the guestbook chair.
stop = await beginMove(page, "a");
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000);
  const prompt = await page.getByTestId("interaction-prompt").textContent().catch(() => null);
  console.log(`t=${i + 1}s prompt=`, prompt);
  if (prompt && prompt.includes("방명록")) break;
}
await stop();
await page.getByTestId("interaction-prompt").click();

await page.waitForSelector('[data-testid="guestbook-letter-editor-modal"]', { timeout: 10000 });
await page.waitForTimeout(600);
await page.screenshot({ path: "/private/tmp/claude-501/-Users-minair-chatbot/73e9d795-0b11-469e-8b27-feed1ced775d/scratchpad/guestbook-editor.png" });

const stickerRow = page.locator("[class*='stickers']").first();
await stickerRow.screenshot({ path: "/private/tmp/claude-501/-Users-minair-chatbot/73e9d795-0b11-469e-8b27-feed1ced775d/scratchpad/sticker-row.png" });

await browser.close();
