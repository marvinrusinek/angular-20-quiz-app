import { TestBed } from '@angular/core/testing';

import { AchievementService } from './achievement.service';
import { Quiz } from '../../models/Quiz.model';
import { SK_QUIZ_ACHIEVEMENTS, SK_QUIZ_BEST_SCORES } from '../../constants/session-keys';

/** Minimal quiz factory — only the fields the achievement rules read. */
function quiz(quizId: string, difficulty?: string): Quiz {
  return { quizId, difficulty } as unknown as Quiz;
}

const BEGINNER = [quiz('b1', 'beginner'), quiz('b2', 'beginner')];
const INTERMEDIATE = [quiz('i1', 'intermediate')];
const ADVANCED = [quiz('a1', 'advanced')];
const ALL: Quiz[] = [...BEGINNER, ...INTERMEDIATE, ...ADVANCED];

describe('AchievementService', () => {
  let service: AchievementService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(AchievementService);
  });

  const earnedIds = (): string[] => [...service.earnedIds()];

  // 1
  it('earns nothing when no quizzes have been completed', () => {
    const newly = service.evaluate(ALL);
    expect(newly).toEqual([]);
    expect(earnedIds()).toEqual([]);
  });

  // 2
  it('awards Perfect Score for a single 100% quiz', () => {
    service.recordQuizResult('b1', 100);
    const newly = service.evaluate(ALL);
    expect(newly.map(a => a.id)).toContain('perfect-score');
  });

  // 3
  it('does NOT award Perfect Score for a completed-but-imperfect quiz', () => {
    service.recordQuizResult('b1', 80);
    const newly = service.evaluate(ALL);
    expect(newly.map(a => a.id)).not.toContain('perfect-score');
  });

  // 4
  it('awards Beginner Complete only when every beginner quiz is completed', () => {
    service.recordQuizResult('b1', 50);
    expect(service.evaluate(ALL).map(a => a.id)).not.toContain('beginner-complete');
    service.recordQuizResult('b2', 10);
    expect(service.evaluate(ALL).map(a => a.id)).toContain('beginner-complete');
  });

  // 5
  it('awards Angular Explorer only when every quiz is completed (any score)', () => {
    for (const q of ALL) service.recordQuizResult(q.quizId, 20);
    const ids = service.evaluate(ALL).map(a => a.id);
    expect(ids).toContain('angular-explorer');
    expect(ids).toContain('beginner-complete');
    expect(ids).toContain('intermediate-complete');
    expect(ids).toContain('advanced-complete');
  });

  // 6
  it('awards Angular Master only when every quiz is 100%', () => {
    for (const q of ALL) service.recordQuizResult(q.quizId, 100);
    expect(service.evaluate(ALL).map(a => a.id)).toContain('angular-master');
  });

  // 7
  it('does NOT award Angular Master if any quiz is below 100%', () => {
    for (const q of ALL) service.recordQuizResult(q.quizId, 100);
    service.recordQuizResult('i1', 90);  // best is still 100 → master should hold
    // now a genuinely imperfect quiz
    localStorage.clear();
    for (const q of ALL) service.recordQuizResult(q.quizId, q.quizId === 'a1' ? 90 : 100);
    expect(service.evaluate(ALL).map(a => a.id)).not.toContain('angular-master');
  });

  // 8
  it('is idempotent — a second evaluate with no new progress returns []', () => {
    service.recordQuizResult('b1', 100);
    expect(service.evaluate(ALL).length).toBeGreaterThan(0);
    expect(service.evaluate(ALL)).toEqual([]);
  });

  // 9
  it('never awards the same achievement twice across evaluations', () => {
    service.recordQuizResult('b1', 100);
    service.evaluate(ALL);
    service.recordQuizResult('b2', 100);  // more progress, but perfect-score already earned
    const newly = service.evaluate(ALL);
    expect(newly.map(a => a.id)).not.toContain('perfect-score');
    expect(earnedIds().filter(id => id === 'perfect-score').length).toBe(1);
  });

  // 10
  it('keeps the BEST score — a lower later attempt does not lower it', () => {
    service.recordQuizResult('b1', 100);
    service.recordQuizResult('b1', 40);
    const best = JSON.parse(localStorage.getItem(SK_QUIZ_BEST_SCORES) ?? '{}');
    expect(best.b1).toBe(100);
  });

  // 11
  it('raises the stored score when a later attempt is higher', () => {
    service.recordQuizResult('b1', 40);
    service.recordQuizResult('b1', 90);
    const best = JSON.parse(localStorage.getItem(SK_QUIZ_BEST_SCORES) ?? '{}');
    expect(best.b1).toBe(90);
  });

  // 12
  it('does not award a difficulty achievement when zero quizzes exist for it', () => {
    const onlyBeginner = [...BEGINNER];
    for (const q of onlyBeginner) service.recordQuizResult(q.quizId, 100);
    const ids = service.evaluate(onlyBeginner).map(a => a.id);
    expect(ids).toContain('beginner-complete');
    expect(ids).not.toContain('intermediate-complete');
    expect(ids).not.toContain('advanced-complete');
  });

  // 13
  it('survives malformed persisted achievement data (drops junk, keeps valid)', () => {
    localStorage.setItem(SK_QUIZ_ACHIEVEMENTS, '{ not valid json');
    expect(() => service.evaluate(ALL)).not.toThrow();
    expect(earnedIds()).toEqual([]);
  });

  // 14
  it('ignores unknown/duplicate ids and non-numeric best scores when reading', () => {
    localStorage.setItem(SK_QUIZ_ACHIEVEMENTS, JSON.stringify([
      { id: 'perfect-score', earnedAt: '2020-01-01T00:00:00.000Z' },
      { id: 'perfect-score', earnedAt: '2020-01-02T00:00:00.000Z' },  // dup
      { id: 'not-a-real-achievement', earnedAt: 'x' }                 // junk
    ]));
    expect(earnedIds()).toEqual(['perfect-score']);  // deduped, junk dropped
  });

  // 15
  it('does not revoke a previously earned achievement when new quizzes are added', () => {
    for (const q of ALL) service.recordQuizResult(q.quizId, 20);
    expect(service.evaluate(ALL).map(a => a.id)).toContain('angular-explorer');
    // A new, uncompleted quiz appears in the catalog.
    const withNew = [...ALL, quiz('b3', 'beginner')];
    service.evaluate(withNew);  // explorer no longer "satisfied" but must NOT be revoked
    expect(earnedIds()).toContain('angular-explorer');
  });

  // Extra: seeds best scores from legacy highScoresLocal on first evaluate.
  it('seeds best scores from legacy highScoresLocal when none stored yet', () => {
    localStorage.setItem('highScoresLocal', JSON.stringify([{ quizId: 'b1', score: 100 }]));
    const newly = service.evaluate(ALL);
    expect(newly.map(a => a.id)).toContain('perfect-score');
  });
});
