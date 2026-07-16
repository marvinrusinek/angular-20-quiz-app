import { computed, Injectable, inject, signal } from '@angular/core';

import { AssessmentConfig } from '../../../models/AssessmentConfig.model';
import { GeneratedAssessment } from '../../../models/GeneratedAssessment.model';

import { AssessmentBuilderService } from '../assessment/assessment-builder.service';

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

  // Tear the session down (on submit or abandon).
  clear(): void {
    this._assessment.set(null);
  }
}
