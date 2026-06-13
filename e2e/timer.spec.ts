import { test, expect, Page } from '@playwright/test';
import { HEADING, NEXT_BTN, PREV_BTN, correctIndexForHeading } from './helpers';

/**
 * Timer freeze-on-revisit guard.
 *
 * Feature (shipped 2026-06-07/08, ~10 hard-won iterations): revisiting a
 * CORRECTLY-answered question shows its countdown FROZEN at the seconds it had
 * when answered — not a fresh full countdown, not running, and not a bogus
 * 0:00 flash. Past bugs: the display reset to 0:30 and counted down, or mirrored
 * another question's time, or flashed 0:00.
 *
 * This needs no app changes / no waiting for expiry: we let a few seconds
 * elapse, answer correctly, leave and come back, and assert the timer is
 * frozen (stable over time, not full, not zero) on revisit.
 */

const TIMER = '.scoreboard-timer .scoreboard';

async function startTs(page: Page) {
  await page.goto('/quiz/intro/typescript');
  await page.locator('.start-btn').click();
  await page.locator('.option-row').first().waitFor({ state: 'visible', timeout: 20_000 });
}

/** Read the countdown seconds from the "0:SS" timer display. */
async function readTimerSeconds(page: Page): Promise<number> {
  const t = (await page.locator(TIMER).textContent()) ?? '';
  const m = t.match(/(\d+):(\d+)/);
  return m ? Number(m[2]) : NaN;
}

test.describe('timer — freeze on revisit of a correctly-answered question', () => {
  test('revisited correct answer shows a frozen (not reset, not zero, not running) timer', async ({ page }) => {
    await startTs(page);
    const rows = page.locator('.option-row');

    // Let a few seconds elapse so the frozen value is clearly < full (30).
    await expect.poll(async () => readTimerSeconds(page), { timeout: 8000 }).toBeLessThanOrEqual(27);

    // Answer Q1 correctly → its timer should freeze for revisits.
    const h = (await page.locator(HEADING).textContent()) ?? '';
    const correctIdx = correctIndexForHeading(h);
    expect(correctIdx).toBeGreaterThanOrEqual(0);
    await rows.nth(correctIdx).click();
    await expect(page.locator(NEXT_BTN)).toBeEnabled();

    // Go forward to Q2, then back to Q1 (the revisit).
    await page.locator(NEXT_BTN).click();
    await expect(page).toHaveURL(/\/2$/);
    await page.locator('.option-row').first().waitFor({ state: 'visible' });
    await page.locator(PREV_BTN).click();
    await expect(page).toHaveURL(/\/1$/);
    await page.locator('.option-row').first().waitFor({ state: 'visible' });

    // On revisit the timer must be frozen:
    const onRevisit = await readTimerSeconds(page);
    expect(Number.isNaN(onRevisit)).toBe(false);
    expect(onRevisit).toBeGreaterThan(0);   // not a bogus 0:00 flash
    expect(onRevisit).toBeLessThan(30);     // not reset to the full countdown

    // ...and not running: stable across ~2.5s (a reset/running timer would tick down).
    await page.waitForTimeout(2500);
    const later = await readTimerSeconds(page);
    expect(later).toBe(onRevisit);
  });
});
