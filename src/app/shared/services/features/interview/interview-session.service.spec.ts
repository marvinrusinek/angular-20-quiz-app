import { TestBed } from '@angular/core/testing';

import { FeedbackPolicyService } from './feedback-policy.service';
import { InterviewSessionService } from './interview-session.service';

describe('InterviewSessionService — feedback lifecycle', () => {
  let session: InterviewSessionService;
  let policy: FeedbackPolicyService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    session = TestBed.inject(InterviewSessionService);
    policy = TestBed.inject(FeedbackPolicyService);
  });

  it('activateDeferredFeedback() defers correctness feedback', () => {
    expect(policy.feedbackMode()).toBe('immediate');
    session.activateDeferredFeedback();
    expect(policy.feedbackMode()).toBe('deferred');
  });

  it('clear() resets feedback to immediate so it cannot leak into normal quizzes', () => {
    session.activateDeferredFeedback();
    expect(policy.isDeferred()).toBe(true);

    session.clear();

    // Leaving / completing the interview restores immediate feedback.
    expect(policy.feedbackMode()).toBe('immediate');
    expect(policy.isDeferred()).toBe(false);
  });
});
