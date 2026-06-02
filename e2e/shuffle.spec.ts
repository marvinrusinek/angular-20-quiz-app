import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Shuffle-mode coverage for the explanation pipeline. The two extractions
 * that previously broke handleOptionClick (browser-only) failed in shuffle
 * mode, so this is the most important safety-net gap to close before any
 * decomposition. Question order is randomized but option order is not, so
 * we resolve the correct option by matching the displayed question text
 * against the quiz data.
 */

const HEADING = 'codelab-quiz-content h3';
const FEEDBACK = 'codelab-quiz-feedback';
const NEXT_BTN = '.nav-btn[aria-label="Next Question"]';

const quizData = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'src/assets/data/quiz.json'), 'utf8')
);
const tsQuiz = quizData.find((q: any) => (q.quizId || q.id) === 'typescript');
const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

function findQuestionForHeading(headingText: string): any {
  const qt = norm(headingText);
  return tsQuiz.questions.find((qq: any) => qt.startsWith(norm(qq.questionText)));
}

function correctIndexForHeading(headingText: string): number {
  const q = findQuestionForHeading(headingText);
  if (!q) return -1;
  return q.options.findIndex(
    (o: any) => o.correct === true || o.correct === 'true' || o.correct === 1
  );
}

async function enableShuffleAndStart(page: Page) {
  await page.goto('/quiz/intro/typescript');
  const toggle = page.locator('mat-slide-toggle button[role="switch"]');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.locator('.start-btn').click();
  await page.locator('.option-row').first().waitFor({ state: 'visible', timeout: 20_000 });
}

test.describe('shuffle mode — explanation pipeline', () => {
  test('correct click shows the explanation for the displayed question', async ({ page }) => {
    await enableShuffleAndStart(page);

    const headingText = (await page.locator(HEADING).textContent()) ?? '';
    const correctIdx = correctIndexForHeading(headingText);
    expect(correctIdx).toBeGreaterThanOrEqual(0);

    await page.locator('.option-row').nth(correctIdx).click();
    await expect(page.locator(HEADING)).toContainText(/is correct because/i);
    await expect(page.locator(FEEDBACK)).toContainText(/right/i);
  });

  test('explanation does not leak across forward navigation in shuffle', async ({ page }) => {
    await enableShuffleAndStart(page);

    const headingText = (await page.locator(HEADING).textContent()) ?? '';
    await page.locator('.option-row').nth(correctIndexForHeading(headingText)).click();
    await expect(page.locator(HEADING)).toContainText(/is correct because/i);

    await page.locator(NEXT_BTN).click();

    // The next heading must be a real (unanswered) question, not the prior
    // explanation and not blank.
    await expect(page.locator(HEADING)).not.toContainText(/is correct because/i);
    await expect
      .poll(async () => {
        const t = (await page.locator(HEADING).textContent()) ?? '';
        return findQuestionForHeading(t) ? 'question' : 'other';
      }, { timeout: 8000 })
      .toBe('question');
  });
});
