import { test, expect, Page } from '@playwright/test';
import { HEADING, NEXT_BTN, RESULTS_BTN, tsQuiz, correctIndexForHeading } from './helpers';

const PANEL = 'mat-expansion-panel';
const PANEL_HEADER = 'mat-expansion-panel-header';
const PANEL_DETAILS = '.progress-summary';

/** Answer the whole typescript quiz (single-answer). `wrongFirst` misses Q1 → 90%. */
async function answerTypescript(page: Page, wrongFirst = false): Promise<void> {
  const total = tsQuiz.questions.length;
  for (let i = 0; i < total; i++) {
    const rows = page.locator('.option-row');
    await rows.first().waitFor({ state: 'visible', timeout: 20_000 });

    await expect
      .poll(async () => correctIndexForHeading((await page.locator(HEADING).textContent()) ?? ''),
        { timeout: 8000 })
      .toBeGreaterThanOrEqual(0);

    const correct = correctIndexForHeading((await page.locator(HEADING).textContent()) ?? '');
    const pick = wrongFirst && i === 0 ? (correct === 0 ? 1 : 0) : correct;
    await rows.nth(pick).click();

    if (i < total - 1) {
      await page.locator(NEXT_BTN).click();
      await expect(page).toHaveURL(new RegExp(`/${i + 2}$`));
    }
  }
  await page.locator(RESULTS_BTN).click();
  await expect(page).toHaveURL(/\/results\//);
}

test('progress updates on completion, persists across refresh, and a lower retake keeps the best score', async ({ page }) => {
  test.setTimeout(120_000);

  // Complete the quiz perfectly (100%).
  await page.goto('/quiz/question/typescript/1');
  await answerTypescript(page);

  // Return to Quiz Selection.
  await page.getByTitle('select quiz').click();
  await page.locator('.quiz-tile').first().waitFor({ state: 'visible', timeout: 20_000 });

  // The progress panel appears, collapsed, with a useful header summary.
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(PANEL_HEADER)).toContainText('1 of 15 completed');
  await expect(page.locator(PANEL_DETAILS)).toBeHidden();  // collapsed by default

  // Expanding reveals the full bar-graph breakdown (overall + difficulty bars).
  await page.locator(PANEL_HEADER).click();
  await expect(page.locator(PANEL_DETAILS)).toBeVisible();
  await expect(page.locator(PANEL_DETAILS)).toContainText('Overall Progress');
  await expect(page.locator(PANEL_DETAILS)).toContainText('Beginner');
  await expect(page.locator(`${PANEL_DETAILS} .progress-summary__bar[role="progressbar"]`).first()).toBeVisible();

  // The completed card shows Completed + Best 100%.
  const completedTile = page.locator('.quiz-tile.completed');
  await expect(completedTile).toHaveCount(1);
  await expect(completedTile.locator('.quiz-card-progress')).toContainText('Completed');
  await expect(completedTile.locator('.quiz-card-progress')).toContainText('100%');

  // Progress visibility persists across a refresh (via existing saved state).
  await page.reload();
  await page.locator('.quiz-tile').first().waitFor({ state: 'visible', timeout: 20_000 });
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(PANEL_HEADER)).toContainText('1 of 15 completed');
  await expect(page.locator('.quiz-tile.completed .quiz-card-progress')).toContainText('100%');

  // Retake with a LOWER score: open the completed quiz → results → Restart.
  await page.locator('.quiz-tile.completed').click();
  await expect(page).toHaveURL(/\/results\//);
  await page.getByTitle('restart').click();
  await expect(page).toHaveURL(/\/question\/typescript\/1$/);
  await answerTypescript(page, /* wrongFirst */ true);  // 90%

  // Back to selection: the best score must remain 100%, not the 90% retake.
  await page.getByTitle('select quiz').click();
  await page.locator('.quiz-tile').first().waitFor({ state: 'visible', timeout: 20_000 });
  await expect(page.locator('.quiz-tile.completed .quiz-card-progress')).toContainText('100%');
  await expect(page.locator('.quiz-tile.completed .quiz-card-progress')).not.toContainText('90%');
});
