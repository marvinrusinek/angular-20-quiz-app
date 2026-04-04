import { Injectable } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Observable, of, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, filter, map, take, takeUntil, tap } from 'rxjs/operators';

import { QuizService } from '../data/quiz.service';
import { QuizNavigationService } from '../flow/quiz-navigation.service';
import { ResetStateService } from '../state/reset-state.service';
import { SharedVisibilityService } from '../ui/shared-visibility.service';

/**
 * Subscription factory service for QQC.
 * Creates and returns Subscription objects that the component owns and tears down.
 * Extracted from QuizQuestionComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QqcSubscriptionWiringService {

  constructor(
    private quizService: QuizService,
    private quizNavigationService: QuizNavigationService,
    private sharedVisibilityService: SharedVisibilityService,
    private resetStateService: ResetStateService,
    private router: Router
  ) {}

  /**
   * Creates the display mode subscription (isAnswered -> mode).
   * Extracted from initializeDisplayModeSubscription().
   */
  createDisplayModeSubscription(
    currentQuestionIndex: number,
    isRestoringState: boolean
  ): Subscription {
    return this.quizService.isAnswered(currentQuestionIndex)
      .pipe(
        map((isAnswered) => (isAnswered ? 'explanation' : 'question')),
        distinctUntilChanged(),
        tap((mode: 'question' | 'explanation') => {
          if (isRestoringState) {
            console.log(`[🛠️ Restoration] Skipping displayMode$ update (${mode})`);
          } else {
            console.log(`[👀 Observed isAnswered ➡️ ${mode}] — no displayMode$ update`);
          }
        }),
        catchError((error) => {
          console.error('❌ Error in display mode subscription:', error);
          return of('question');
        })
      )
      .subscribe();
  }

  /**
   * Creates the page visibility subscription.
   * Extracted from setupVisibilitySubscription().
   */
  createVisibilitySubscription(callbacks: {
    onHidden: () => void;
    onVisible: () => void;
  }): Subscription {
    return this.sharedVisibilityService.pageVisibility$.subscribe((isHidden) => {
      if (isHidden) {
        callbacks.onHidden();
      } else {
        callbacks.onVisible();
      }
    });
  }

  /**
   * Creates the route listener subscription.
   * Calls onRouteChange with the parsed zero-based question index.
   * Extracted from initializeRouteListener().
   */
  createRouteListener(params: {
    activatedRoute: ActivatedRoute;
    getQuestionsLength: () => number;
    onRouteChange: (adjustedIndex: number) => void;
  }): Subscription {
    return this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        const paramIndex =
          params.activatedRoute.snapshot.paramMap.get('questionIndex');
        const index = paramIndex ? +paramIndex : 0;

        const questionsLength = params.getQuestionsLength();
        if (questionsLength === 0) {
          console.warn('Questions are not loaded yet.');
          return;
        }

        const adjustedIndex = Math.max(0, Math.min(index - 1, questionsLength - 1));
        params.onRouteChange(adjustedIndex);
      });
  }

  /**
   * Creates navigation flag subscription.
   * Extracted from subscribeToNavigationFlags().
   */
  createNavigationFlagSubscription(
    onNavigating: (isNavigating: boolean) => void
  ): Subscription {
    return this.quizNavigationService.getIsNavigatingToPrevious().subscribe(onNavigating);
  }

  /**
   * Creates total questions subscription.
   * Extracted from subscribeToTotalQuestions().
   */
  createTotalQuestionsSubscription(params: {
    quizId: string;
    destroy$: Subject<void>;
    onTotal: (total: number) => void;
  }): Subscription {
    return this.quizService.getTotalQuestionsCount(params.quizId)
      .pipe(takeUntil(params.destroy$))
      .subscribe(params.onTotal);
  }

  /**
   * Creates the reset feedback + reset state subscriptions.
   * Returns an array of subscriptions for bulk teardown.
   * Extracted from setupSubscriptions().
   */
  createResetSubscriptions(callbacks: {
    onResetFeedback: () => void;
    onResetState: () => void;
  }): Subscription[] {
    return [
      this.resetStateService.resetFeedback$.subscribe(callbacks.onResetFeedback),
      this.resetStateService.resetState$.subscribe(callbacks.onResetState),
    ];
  }
}
