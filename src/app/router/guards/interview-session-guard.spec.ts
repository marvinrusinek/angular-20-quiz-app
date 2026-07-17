import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';

import { Quiz } from '../../shared/models/Quiz.model';
import { setQuizDataCache } from '../../shared/quiz-data-cache';
import { InterviewSessionService } from '../../shared/services/features/interview/interview-session.service';

import { InterviewSessionGuard } from './interview-session-guard';

const catalog: Quiz[] = [{
  quizId: 'ts', milestone: 'TS', summary: '', image: '', difficulty: 'beginner',
  questions: Array.from({ length: 10 }, (_, i) => ({
    questionText: `q${i}`, options: [{ text: 'A', correct: true }, { text: 'B' }], explanation: 'e'
  }))
}];

describe('InterviewSessionGuard', () => {
  let guard: InterviewSessionGuard;
  let session: InterviewSessionService;
  let router: Router;

  beforeEach(() => {
    try { sessionStorage.clear(); } catch { /* jsdom */ }
    setQuizDataCache(catalog, []);
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    guard = TestBed.inject(InterviewSessionGuard);
    session = TestBed.inject(InterviewSessionService);
    router = TestBed.inject(Router);
  });

  afterEach(() => setQuizDataCache([], []));

  it('redirects to the builder when there is no active session', () => {
    const result = guard.canActivate();
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/interview');
  });

  it('allows access when an assessment is active', () => {
    session.start({ difficulty: 'mixed', topicIds: ['ts'], questionCount: 10 });
    expect(guard.canActivate()).toBe(true);
  });

  it('blocks re-entering a submitted session', () => {
    session.start({ difficulty: 'mixed', topicIds: ['ts'], questionCount: 10 });
    session.setTiming(Date.now() + 1000, 900);
    session.submit(1, 899, false);
    expect(guard.canActivate()).toBeInstanceOf(UrlTree);
  });
});
