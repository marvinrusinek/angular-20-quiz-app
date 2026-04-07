import { Injectable } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { BehaviorSubject, Observable, of, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, filter, map, skip, takeUntil, tap } from 'rxjs/operators';

import { Option } from '../../../models/Option.model';
import { QuestionPayload } from '../../../models/QuestionPayload.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';
import { QuizService } from '../../data/quiz.service';
import { QuizNavigationService } from '../../flow/quiz-navigation.service';
import { ResetStateService } from '../../state/reset-state.service';
import { SharedVisibilityService } from '../../ui/shared-visibility.service';

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

  /**
   * Creates subscription for questionPayload$ stream.
   * Applies payload data to component state on each emission.
   * Extracted from ngOnInit (lines 485–499).
   */
  createQuestionPayloadSubscription(callbacks: {
    onPayload: (payload: QuestionPayload) => void;
  }): Subscription {
    return this.quizService.questionPayload$
      .pipe(
        filter((payload): payload is QuestionPayload => !!payload),
        tap((payload: QuestionPayload) => {
          callbacks.onPayload(payload);
        })
      )
      .subscribe((payload: QuestionPayload) => {
        console.time('[📥 QQC received QA]');
        console.log('[📥 QQC got payload]', payload);
        console.timeEnd('[📥 QQC received QA]');
      });
  }

  /**
   * Creates subscription for checkedShuffle$ preference stream.
   * Extracted from ngOnInit (lines 501–504).
   */
  createShufflePreferenceSubscription(
    onShuffle: (shouldShuffle: boolean) => void
  ): Subscription {
    return this.quizService.checkedShuffle$.subscribe(onShuffle);
  }

  /**
   * Creates subscriptions for all QuizNavigationService event streams.
   * Returns an array of subscriptions for bulk teardown.
   * Extracted from ngOnInit (lines 506–551).
   */
  createNavigationEventSubscriptions(callbacks: {
    onNavigationSuccess: () => void;
    onNavigatingBack: (sharedOptionComponent: any) => void;
    onNavigationToQuestion: (data: { question: QuizQuestion; options: Option[] }) => void;
    onExplanationReset: () => void;
    onRenderReset: () => void;
    onResetUIForNewQuestion: () => void;
  }): Subscription[] {
    const subs: Subscription[] = [];

    subs.push(
      this.quizNavigationService.navigationSuccess$.subscribe(() => {
        console.info('[QQC] 📦 navigationSuccess$ received — general navigation');
        callbacks.onNavigationSuccess();
      })
    );

    subs.push(
      this.quizNavigationService.navigatingBack$.subscribe(() => {
        console.info('[QQC] 🔙 navigatingBack$ received');
        callbacks.onNavigatingBack(null); // component passes sharedOptionComponent reference
      })
    );

    subs.push(
      this.quizNavigationService.navigationToQuestion$.subscribe(
        ({ question, options }) => {
          if (question?.questionText && options?.length) {
            callbacks.onNavigationToQuestion({ question, options });
          } else {
            console.warn('[🚫 Dynamic injection skipped]', {
              questionText: question?.questionText,
              optionsLength: options?.length,
            });
          }
        }
      )
    );

    subs.push(
      this.quizNavigationService.explanationReset$.subscribe(() => {
        callbacks.onExplanationReset();
      })
    );

    subs.push(
      this.quizNavigationService.renderReset$.subscribe(() => {
        callbacks.onRenderReset();
      })
    );

    subs.push(
      this.quizNavigationService.resetUIForNewQuestion$.subscribe(() => {
        callbacks.onResetUIForNewQuestion();
      })
    );

    return subs;
  }

  /**
   * Creates subscription for quizService.preReset$ stream.
   * Resets per-question state when a new question index is emitted.
   * Extracted from ngOnInit (lines 553–562).
   */
  createPreResetSubscription(params: {
    destroy$: Subject<void>;
    onPreReset: (idx: number) => void;
    getLastResetFor: () => number;
    setLastResetFor: (idx: number) => void;
  }): Subscription {
    return this.quizService.preReset$
      .pipe(
        takeUntil(params.destroy$),
        filter(idx => Number.isFinite(idx as number) && (idx as number) >= 0),
        filter(idx => idx !== params.getLastResetFor()),
        tap(idx => params.setLastResetFor(idx as number))
      )
      .subscribe(idx => {
        params.onPreReset(idx as number);
      });
  }

  /**
   * Creates subscription for timerService.expired$ stream.
   * Extracted from ngOnInit (lines 599–604).
   */
  createTimerExpiredSubscription(params: {
    destroy$: Subject<void>;
    timerExpired$: Observable<void>;
    onExpired: () => void;
  }): Subscription {
    return params.timerExpired$
      .pipe(takeUntil(params.destroy$))
      .subscribe(() => {
        params.onExpired();
      });
  }

  /**
   * Creates subscription for timerService.stop$ stream.
   * Skips the first emission and handles timer stop with microtask.
   * Extracted from ngOnInit (lines 606–613).
   */
  createTimerStopSubscription(params: {
    destroy$: Subject<void>;
    timerStop$: Observable<any>;
    onTimerStopped: () => void;
  }): Subscription {
    return params.timerStop$
      .pipe(skip(1), takeUntil(params.destroy$))
      .subscribe(() => {
        queueMicrotask(() => {
          params.onTimerStopped();
        });
      });
  }

  /**
   * Creates subscription for currentQuestionIndex$ logging stream.
   * Extracted from ngOnInit (lines 470–479).
   */
  createCurrentQuestionIndexSubscription(
    onIndex: (index: number) => void
  ): Subscription {
    return this.quizService.currentQuestionIndex$.subscribe((index: number) => {
      // Log a stack trace for tracing unexpected emissions
      if (index === 1) {
        console.warn('[🧵 Stack trace for index === 1]', {
          stack: new Error().stack
        });
      }

      onIndex(index);
    });
  }

  /**
   * Creates subscription for activatedRoute.paramMap changes.
   * Resets explanation state and fetches question for each route change.
   * Extracted from ngOnInit (lines 564–586).
   */
  createRouteParamSubscription(params: {
    activatedRoute: ActivatedRoute;
    onRouteChange: (questionIndex: number) => Promise<void>;
  }): Subscription {
    return params.activatedRoute.paramMap.subscribe(async (paramMap) => {
      const rawParam = paramMap.get('questionIndex');
      const routeIndex = Number(rawParam);
      const questionIndex = Math.max(0, routeIndex - 1); // Normalize to 0-based

      await params.onRouteChange(questionIndex);
    });
  }

  /**
   * Creates the handleRouteChanges subscription that loads questions
   * and updates explanation state on each route param change.
   * Extracted from handleRouteChanges() (lines 1144–1212).
   */
  createRouteChangeHandlerSubscription(params: {
    activatedRoute: ActivatedRoute;
    getTotalQuestions: () => number;
    parseRouteIndex: (rawParam: string | null) => number;
    onRouteChange: (zeroBasedIndex: number, displayIndex: number) => Promise<void>;
  }): Subscription {
    return params.activatedRoute.paramMap.subscribe(async (paramMap) => {
      const rawParam = paramMap.get('questionIndex');

      // Delegate route parsing
      const zeroBasedIndex = params.parseRouteIndex(rawParam);
      const displayIndex = zeroBasedIndex + 1; // 1-based for logging

      try {
        await params.onRouteChange(zeroBasedIndex, displayIndex);
      } catch (error) {
        console.error('[handleRouteChanges] ❌ Unexpected error:', error);
      }
    });
  }
}
