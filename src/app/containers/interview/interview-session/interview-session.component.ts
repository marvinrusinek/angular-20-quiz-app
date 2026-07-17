import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  ViewEncapsulation
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { Router } from '@angular/router';

import { Option } from '../../../shared/models/Option.model';
import { QuizQuestion } from '../../../shared/models/QuizQuestion.model';

import { InterviewSessionService } from '../../../shared/services/features/interview/interview-session.service';

import { InterviewPaginatorComponent } from '../../../components/interview/interview-paginator/interview-paginator.component';
import { InterviewOptionsComponent } from '../../../components/interview/interview-options/interview-options.component';

/**
 * Interview session shell.
 *
 * The question text is rendered directly inside the regular quiz question box
 * (the topic quizzes' `mat-card.quiz-card` container). We do NOT route it through
 * `codelab-quiz-content`: that heading component only produces text when the full
 * `codelab-quiz-question` pipeline runs alongside it (it reads shared state that
 * pipeline primes), and that pipeline can't drive a synthetic in-memory
 * assessment. Rendering the text directly guarantees it always shows; deferred
 * feedback means the heading is always the question text (never FET), by design.
 *
 * Options use InterviewOptionsComponent — native radio (single) / checkbox
 * (multiple), styled neutrally with correctness colors/icons/explanations
 * suppressed. Navigation moves the session index signal (no URL change).
 */
@Component({
  selector: 'codelab-interview-session',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    InterviewPaginatorComponent,
    InterviewOptionsComponent
  ],
  templateUrl: './interview-session.component.html',
  styleUrls: ['./interview-session.component.scss'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InterviewSessionComponent implements OnInit, OnDestroy {
  private readonly session = inject(InterviewSessionService);
  private readonly router = inject(Router);

  readonly currentIndex = this.session.currentIndex;
  readonly total = this.session.total;
  readonly answeredIndices = this.session.answeredIndices;

  readonly currentQuestion = computed<QuizQuestion | null>(
    () => this.session.assessment()?.questions?.[this.currentIndex()] ?? null
  );

  readonly questionText = computed<string>(() => this.currentQuestion()?.questionText ?? '');
  readonly currentOptions = computed<Option[]>(() => this.currentQuestion()?.options ?? []);

  readonly selectedIds = computed<number[]>(
    () => this.session.answersByIndex()[this.currentIndex()] ?? []
  );

  ngOnInit(): void {
    if (!this.session.hasActiveSession()) {
      this.router.navigate(['/interview']);
      return;
    }
    this.session.activateDeferredFeedback();
  }

  ngOnDestroy(): void {
    // Leaving the interview restores immediate feedback so Interview state can't
    // leak into normal topic quizzes.
    this.session.clear();
  }

  // Paginator / prev / next → move the session index (no router navigation).
  onNavigate(index: number): void {
    this.session.goTo(index);
  }

  // Persist the current question's selection (drives the answered counter).
  onSelectionChange(optionIds: number[]): void {
    this.session.setAnswer(this.currentIndex(), optionIds);
  }
}
