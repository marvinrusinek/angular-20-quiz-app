import { computed, Injectable, inject, signal } from '@angular/core';

import { AssessmentConfig } from '../../../models/AssessmentConfig.model';
import { GeneratedAssessment } from '../../../models/GeneratedAssessment.model';

import { AssessmentBuilderService } from '../assessment/assessment-builder.service';
import { FeedbackPolicyService } from './feedback-policy.service';

/**
 * Owns the active Interview session. In this milestone it holds the generated
 * assessment produced when the user starts an interview; later milestones extend
 * it with per-question answers, current index, status, the countdown, and
 * sessionStorage persistence/resume. It deliberately does NOT touch any
 * topic-quiz progress/best-score/achievement state.
 */
@Injectable({ providedIn: 'root' })
export class InterviewSessionService {
  private readonly builder = inject(AssessmentBuilderService);
  private readonly feedbackPolicy = inject(FeedbackPolicyService);

  private readonly _assessment = signal<GeneratedAssessment | null>(null);
  readonly assessment = this._assessment.asReadonly();

  // Whether a valid interview session currently exists (used by the session
  // route guard in a later milestone).
  readonly hasActiveSession = computed(
    () => (this._assessment()?.questions?.length ?? 0) > 0
  );

  // Build a temporary assessment from the config and begin the session. Throws
  // (via the builder) if the pool can't satisfy the request — callers validate
  // first, so this is a defensive guarantee.
  start(config: AssessmentConfig): GeneratedAssessment {
    const assessment = this.builder.build(config);
    this._assessment.set(assessment);
    return assessment;
  }

  // Enter the interview: defer correctness feedback. Called by the session
  // component ON MOUNT (not by start()), so 'deferred' is only ever active while
  // the interview screen is displayed — it can never get stuck on if navigation
  // into the session fails.
  activateDeferredFeedback(): void {
    this.feedbackPolicy.setMode('deferred');
  }

  // Tear the session down (on leave, submit, or abandon). ALWAYS restores
  // immediate feedback so Interview state can never leak into normal topic
  // quizzes — the session component calls this on destroy, and submission too.
  clear(): void {
    this._assessment.set(null);
    this.feedbackPolicy.reset();
  }
}
