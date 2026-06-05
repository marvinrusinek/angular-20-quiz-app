import { test, expect, Page } from '@playwright/test';
import {
  diQuiz, HEADING, FEEDBACK, NEXT_BTN, RESULTS_BTN,
  findQuestionIn, correctIndicesForHeading,
} from './helpers';

/**
 * Dependency-injection quiz coverage — the most COMPLEX quiz in the app: it
 * has multi-answer questions (Q2, Q4), which the typescript quiz lacks
 * entirely. Multi-answer exercises the hardest paths (the FET gate, the
 * "all correct found" logic, partial-correct handling), so this closes the
 * biggest gap in the playthrough net.
 *
 * Question order is randomized in shuffle; option order is not. The correct
 * option(s) are resolved by matching the displayed heading to the quiz data
 * (multi-answer aware via correctIndicesForHeading).
 */

async function startDi(page: Page, shuffle: boolean) {
  await page.goto('/quiz/intro/dependency-injection');
  if (shuffle) {
    const toggle = page.locator('mat-slide-toggle button[role="switch"]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  }
  await page.locator('.start-btn').click();
  await page.locator('.option-row').first().waitFor({ state: 'visible', timeout: 20_000 });
}

/**
 * Walk the whole DI quiz in display order. For each question, click ALL correct
 * options (multi-answer aware); for positions in `wrongAt`, click a single
 * deliberately-incorrect option instead. Ends on the results page.
 */
async function playThroughDi(page: Page, wrongAt: Set<number>) {
  const total = diQuiz.questions.length;
  for (let pos = 0; pos < total; pos++) {
    const rows = page.locator('.option-row');
    await rows.first().waitFor({ state: 'visible', timeout: 20_000 });

    // Wait until the heading resolves to a known DI question.
    await expect
      .poll(async () =>
        correctIndicesForHeading(diQuiz, (await page.locator(HEADING).textContent()) ?? '').length,
        { timeout: 8000 })
      .toBeGreaterThan(0);

    const heading = (await page.locator(HEADING).textContent()) ?? '';
    const correct = correctIndicesForHeading(diQuiz, heading);
    const optCount = await rows.count();

    if (wrongAt.has(pos)) {
      // Click a single incorrect option.
      const wrongIdx = [...Array(optCount).keys()].find((i) => !correct.includes(i)) ?? 0;
      await rows.nth(wrongIdx).click();
      await page.waitForTimeout(300);
    } else {
      // Click every correct option (one click each), in order.
      for (const idx of correct) {
        await rows.nth(idx).click();
        await page.waitForTimeout(250);
      }
    }

    if (pos < diQuiz.questions.length - 1) {
      await page.locator(NEXT_BTN).click(); // auto-waits for enabled
      await expect(page).toHaveURL(new RegExp(`/${pos + 2}$`));
    }
  }
  await page.locator(RESULTS_BTN).click();
  await expect(page).toHaveURL(/\/results\//);
}

async function readScore(page: Page): Promise<{ correct: number; total: number; pct: number }> {
  const scoreTab = page.locator('text=Score Analysis').first();
  if (await scoreTab.count()) {
    await scoreTab.click().catch(() => {});
  }
  await page.locator('.your-score').first().waitFor({ state: 'visible', timeout: 15_000 });
  const results = page.locator('.your-score .result');
  const correct = Number((await results.nth(0).textContent())?.trim());
  const total = Number((await results.nth(1).textContent())?.trim());
  const pctText = (await page.locator('.percentage').first().textContent()) ?? '';
  const pct = Number(pctText.replace('%', '').trim());
  return { correct, total, pct };
}

test.describe('dependency-injection — multi-answer correctness (control, non-shuffle)', () => {
  test('all-correct scores 100% (clicking every correct option per question)', async ({ page }) => {
    await startDi(page, false);
    await playThroughDi(page, new Set());
    const { correct, total, pct } = await readScore(page);
    expect(total).toBe(diQuiz.questions.length);
    expect(correct).toBe(total);
    expect(pct).toBe(100);
  });

  test('multi-answer question shows its explanation once all correct options are selected', async ({ page }) => {
    await startDi(page, false);
    const rows = page.locator('.option-row');

    // Walk forward to the first multi-answer question.
    const total = diQuiz.questions.length;
    for (let pos = 0; pos < total; pos++) {
      await rows.first().waitFor({ state: 'visible', timeout: 20_000 });
      const heading = (await page.locator(HEADING).textContent()) ?? '';
      const correct = correctIndicesForHeading(diQuiz, heading);

      if (correct.length > 1) {
        // Select all correct options; the explanation should then appear.
        for (const idx of correct) {
          await rows.nth(idx).click();
          await page.waitForTimeout(250);
        }
        await expect(page.locator(NEXT_BTN)).toBeEnabled();
        await expect(page.locator(FEEDBACK)).toContainText(/\w/, { timeout: 8000 });
        return; // asserted the multi-answer FET path; done.
      }

      // Single-answer: click the correct one and advance.
      await rows.nth(correct[0]).click();
      await page.waitForTimeout(250);
      await page.locator(NEXT_BTN).click();
      await expect(page).toHaveURL(new RegExp(`/${pos + 2}$`));
    }
    throw new Error('No multi-answer question found in the DI quiz');
  });
});

test.describe('dependency-injection — multi-answer correctness (shuffle)', () => {
  test('all-correct in shuffle scores 100%', async ({ page }) => {
    await startDi(page, true);
    await playThroughDi(page, new Set());
    const { correct, total, pct } = await readScore(page);
    expect(total).toBe(diQuiz.questions.length);
    expect(correct).toBe(total);
    expect(pct).toBe(100);
  });
});
