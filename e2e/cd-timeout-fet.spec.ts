import { test, expect } from '@playwright/test';
import { HEADING, NEXT_BTN } from './helpers';

// The FET (explanation) must appear when the question timer expires on EVERY
// question, not just Q1. Regression: a spurious restartForQuestion() after the
// timeout wiped expiredForQuestionIndexSig, so Q2+ showed the question instead.
const FET_RE = /correct because/i;

async function navTo(page: any, target: number) {
  await page.goto('/quiz/question/change-detection/1');
  const rows = page.locator('.option-row');
  await rows.first().waitFor({ state: 'visible', timeout: 20_000 });
  for (let i = 1; i < target; i++) {
    await page.locator(NEXT_BTN).click();
    await expect(page).toHaveURL(new RegExp(`/${i + 1}$`));
    await rows.first().waitFor({ state: 'visible' });
  }
}

for (const q of [1, 2, 3]) {
  test(`CD Q${q}: timer expiry shows the FET`, async ({ page }) => {
    // Q2+ are reached by letting each prior question's timer expire (Next is
    // disabled until then), so the run needs headroom for several ~30s timers.
    test.setTimeout(240_000);
    await navTo(page, q);
    // Let the timer expire with NO interaction -> FET must appear in the heading.
    await expect(page.locator(HEADING)).toContainText(FET_RE, { timeout: 90_000 });
  });
}
