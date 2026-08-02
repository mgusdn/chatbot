import { chromium } from "playwright";
const shot = (n) => `/private/tmp/claude-501/-Users-minair-chatbot/fb2a81d0-ff6b-4996-aa2f-58571dfc5466/scratchpad/${n}.png`;
const browser = await chromium.launch({ args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://127.0.0.1:3000", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.locator("button").first().click();
await page.waitForTimeout(1000);
await page.locator('[role="radio"][aria-label^="나비"]').click();
await page.fill("#playerNickname", "테스터");
await page.waitForTimeout(200);
await page.locator('[data-testid="confirm-character"]').click();
await page.waitForTimeout(3500);

const doorPrompt = page.getByTestId("interaction-prompt").filter({ hasText: "문 열기" });
await page.keyboard.down("Shift");
await page.keyboard.down("w");
await doorPrompt.waitFor({ state: "visible", timeout: 20000 });
await page.keyboard.up("w");
await page.keyboard.up("Shift");
await doorPrompt.click();
await page.waitForTimeout(2500);
await page.screenshot({ path: shot("recon-spawn") });

// Walk in and right to see cowork area (bottom-right) and hamster/installation area
await page.keyboard.down("w"); await page.keyboard.down("d");
await page.waitForTimeout(2200);
await page.keyboard.up("w"); await page.keyboard.up("d");
await page.waitForTimeout(400);
await page.screenshot({ path: shot("recon-right-center") });

await page.keyboard.down("w");
await page.waitForTimeout(1500);
await page.keyboard.up("w");
await page.waitForTimeout(400);
await page.screenshot({ path: shot("recon-right-upper") });

await browser.close();
console.log("DONE");
