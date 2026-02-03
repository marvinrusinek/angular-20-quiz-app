import { Injectable, NgZone } from '@angular/core';
import { ActivatedRoute, ActivatedRouteSnapshot, Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom, Observable, of, Subject } from 'rxjs';
import { catchError, take } from 'rxjs/operators';

import { Option } from '../models/Option.model';
import { QuestionType } from '../models/question-type.enum';
import { QuizQuestion } from '../models/QuizQuestion.model';
import { ExplanationTextService } from './explanation-text.service';
import { NextButtonStateService } from './next-button-state.service';
import { QuizQuestionLoaderService } from './quizquestionloader.service';
import { QuizQuestionManagerService } from './quizquestionmgr.service';
import { QuizService } from './quiz.service';
import { QuizDataService } from './quizdata.service';
import { QuizStateService } from './quizstate.service';
import { SelectedOptionService } from './selectedoption.service';
import { TimerService } from './timer.service';
import { QuizRoutes } from '../models/quiz-routes.enum';

@Injectable({ providedIn: 'root' })
export class QuizNavigationService {
  private quizId = '';
  question!: QuizQuestion;
  currentQuestion: QuizQuestion | null = null;
  currentQuestionIndex = 0;
  totalQuestions = 0;
  questionReady = false;
  answers = [];

  optionsToDisplay: Option[] = [];
  explanationToDisplay = '';

  isNavigating = false;
  isOptionSelected = false;
  quizCompleted = false;

  private navigationSuccessSubject = new Subject<void>();
  navigationSuccess$ = this.navigationSuccessSubject.asObservable();

  private navigatingBackSubject = new Subject<boolean>();
  navigatingBack$ = this.navigatingBackSubject.asObservable();

  private navigationToQuestionSubject = new Subject<{
    question: QuizQuestion,
    options: Option[]
  }>();
  public navigationToQuestion$ =
    this.navigationToQuestionSubject.asObservable();
  private isNavigatingToPrevious = new BehaviorSubject<boolean>(false);

  private explanationResetSubject = new Subject<void>();
  explanationReset$ = this.explanationResetSubject.asObservable();

  private resetUIForNewQuestionSubject = new Subject<void>();
  resetUIForNewQuestion$ = this.resetUIForNewQuestionSubject.asObservable();

  private renderResetSubject = new Subject<void>();
  renderReset$ = this.renderResetSubject.asObservable();

  private _fetchInProgress = false;  // prevents overlapping question fetches

  constructor(
    private explanationTextService: ExplanationTextService,
    private nextButtonStateService: NextButtonStateService,
    private quizQuestionLoaderService: QuizQuestionLoaderService,
    private quizQuestionManagerService: QuizQuestionManagerService,
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    private timerService: TimerService,
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private ngZone: NgZone
  ) { }

  public async advanceToNextQuestion(): Promise<boolean> {
    if (this.isNavigating) {
      console.warn('[NAV] ⚠️ advanceToNextQuestion ignored - isNavigating is TRUE');
      return false;
    }

    // Record elapsed time for current question before navigating
    const currentIndex = this.quizService.getCurrentQuestionIndex();
    if (currentIndex >= 0) {
      // Get elapsed time from the timer's current value if not already stored
      const currentElapsed = (this.timerService as any).elapsedTime ?? 0;
      if (!this.timerService.elapsedTimes[currentIndex] && currentElapsed > 0) {
        this.timerService.elapsedTimes[currentIndex] = currentElapsed;
      }
    }

    try {
      this.resetExplanationAndState();
    } catch (err) {
      console.warn('[NAV DEBUG] resetExplanationAndState failed, but proceeding', err);
    }

    return await this.navigateWithOffset(1);  // defer navigation until state is clean
  }

  public async advanceToPreviousQuestion(): Promise<boolean> {
    try {
      // Do not wipe everything; only clear transient display flags if necessary
      this.quizStateService.setLoading(false);

      // Clear only ephemeral fields (no deep reset)
      (this as any).displayExplanation = false;
      (this as any).explanationToDisplay = '';
      this.explanationTextService.setShouldDisplayExplanation(false);
    } catch (err) {
      console.warn(
        '[NAV] ⚠️ partial reset before previous question failed', err
      );
    }

    return await this.navigateWithOffset(-1);
  }

  private async navigateWithOffset(offset: number): Promise<boolean> {
    // Get Current Index (Robust URL Parsing)
    const getUrlIndex = (): number => {
      try {
        const url = this.router.url;
        // Robust Regex: match /quiz/question/<quizId>/<number> anywhere in string
        const match = url.match(/\/quiz\/question\/[^/]+\/(\d+)/);
        if (match && match[1]) {
          return parseInt(match[1], 10);
        }
        // Fallback: split logic
        const segments = url.split('/');
        const last = segments[segments.length - 1];
        const n = parseInt(last, 10);
        return isNaN(n) ? 0 : n;
      } catch (e) {
        return 0;
      }
    };

    const currentRouteIndex = getUrlIndex();
    const targetRouteIndex = currentRouteIndex + offset;

    // User requested logic: Check if answered.
    const isAnswered = this.selectedOptionService.isQuestionAnswered(currentRouteIndex - 1);
    console.log(`[NAV FORCE] Logic Check: Q${currentRouteIndex} Answered? ${isAnswered}`);

    console.log(`[NAV FORCE] URL Index: ${currentRouteIndex} -> Target: ${targetRouteIndex}`);

    // Get Quiz ID (best effort, fallback to 'angular-quiz')
    let quizId = this.resolveEffectiveQuizId();
    if (!quizId) {
      console.warn('[NAV FORCE] No quizId found, defaulting to "angular-quiz"');
      quizId = 'angular-quiz';
    }

    // Simple Bounds Safety (only check min)
    if (targetRouteIndex < 1) {
      console.warn('[NAV] Cannot navigate below Q1');
      return false;
    }

    const maxQuestions = this.quizService.totalQuestions || this.quizService.questions?.length || 99;

    console.log(`[NAV DEBUG] navigateWithOffset: Current=${currentRouteIndex} Target=${targetRouteIndex} Max=${maxQuestions} (ServiceTotal=${this.quizService.totalQuestions})`);

    if (targetRouteIndex > maxQuestions) {
      console.warn(`[NAV FORCE] Target ${targetRouteIndex} > Max ${maxQuestions}. Proceeding anyway to verify existence.`);
    }

    return this.navigateToQuestion(targetRouteIndex - 1);
  }

  public async navigateToQuestion(index: number): Promise<boolean> {
    this._fetchInProgress = true;

    // HARD reset render state before route change
    this.resetRenderStateBeforeNavigation(index);

    try {
      // Set navigating state
      this.isNavigating = true;
      this.quizStateService.setNavigating(true);
      this.quizStateService.setLoading(true);

      // Perform Router Navigation
      const navSuccess = await this.performRouterNavigation(index);
      if (!navSuccess) {
        console.error('[NAV] Router navigation failed');
        return false;
      }

      // Reset timer state before emitting the new index to avoid immediate expiry
      this.timerService.stopTimer(undefined, { force: true });
      this.timerService.resetTimer();
      this.timerService.resetTimerFlagsFor(index);

      // Update Service State (Index) - Update AFTER router nav success
      this.quizService.setCurrentQuestionIndex(index);
      this.currentQuestionIndex = index;

      // Reset UI States for New Question
      this.resetExplanationAndState();
      this.selectedOptionService.setAnswered(false, true);

      // Clear all option selections when navigating to new question
      this.nextButtonStateService.reset();
      this.quizQuestionLoaderService.resetUI();

      // Fetch New Question Data
      const fresh = await this.fetchAndEmitQuestion(index);
      if (!fresh) {
        console.error('[NAV] Failed to fetch new question data');
        return false;
      }

      // Finalize
      this.notifyNavigationSuccess();

      return true;
    } catch (err) {
      console.error('[❌ navigateToQuestion error]', err);
      return false;
    } finally {
      this._fetchInProgress = false;
      this.isNavigating = false;
      this.quizStateService.setNavigating(false);
      this.quizStateService.setLoading(false);
      console.log(`[NAV DEBUG] navigateToQuestion END. Index: ${index}`);
    }
  }

  private async performRouterNavigation(index: number): Promise<boolean> {
    const quizIdFromRoute = this.activatedRoute.snapshot.paramMap.get('quizId');
    const fallbackQuizId = localStorage.getItem('quizId');
    const quizId = quizIdFromRoute || fallbackQuizId;

    const routeUrl = `/quiz/question/${quizId}/${index + 1}`;
    const currentUrl = this.router.url;
    const currentIndex = this.quizService.getCurrentQuestionIndex();

    // Handle same-URL reload scenario
    if (currentIndex === index && currentUrl === routeUrl) {
      console.log('[NAV DEBUG] Same URL detected. Reloading root first.');
      await this.ngZone.run(() =>
        this.router.navigateByUrl('/', { skipLocationChange: true })
      );
    }

    const navSuccess = await this.ngZone.run(() =>
      this.router.navigateByUrl(routeUrl)
    );
    if (!navSuccess) {
      console.warn('[⚠️ Router navigateByUrl returned false]', routeUrl);
      return false;
    }

    return true;
  }

  private async fetchAndEmitQuestion(index: number): Promise<any> {
    const fresh = await firstValueFrom(
      this.quizService.getQuestionByIndex(index)
    );
    if (!fresh) {
      console.warn(`[NAV] ⚠️ getQuestionByIndex(${index}) returned null`);
      return null;
    }

    this.quizService.setCurrentQuestionIndex(index);

    // Reset FET caches
    try {
      const ets: any = this.explanationTextService;
      ets._activeIndex = index;
      ets.formattedExplanationSubject?.next('');
      ets.shouldDisplayExplanationSubject?.next(false);
      ets.isExplanationTextDisplayedSubject?.next(false);

      if (ets._byIndex) {
        for (const subj of ets._byIndex.values()) subj?.next?.('');
      }

      if (ets._gate) {
        for (const gate of ets._gate.values()) gate?.next?.(false);
      }
    } catch (err) {
      console.warn('[NAV] ⚠️ Failed to purge FET cache', err);
    }

    // Prepare text
    const isMulti =
      (fresh.type as any) === QuestionType.MultipleAnswer ||
      (Array.isArray(fresh.options) &&
        fresh.options.filter((o) => o.correct).length > 1);

    const trimmedQ = (fresh.questionText ?? '').trim();
    const explanationRaw = (fresh.explanation ?? '').trim();
    const numCorrect = (fresh.options ?? []).filter((o) => o.correct).length;
    const totalOpts = (fresh.options ?? []).length;

    const banner = isMulti
      ? this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
        numCorrect,
        totalOpts
      )
      : '';

    // WAIT for DOM to stabilize before final emission
    const qqls = this.quizQuestionLoaderService;
    await qqls.waitForDomStable(32);

    qqls._frozen = false;
    qqls._isVisualFrozen = false;
    qqls._renderFreezeUntil = 0;
    qqls._quietZoneUntil = performance.now() - 1;
    qqls.quietZoneUntil$?.next(qqls._quietZoneUntil);

    const ets: any = this.explanationTextService;
    ets._hardMuteUntil = performance.now() - 1;

    // Emit question and banner
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        try {
          qqls.emitQuestionTextSafely(trimmedQ, index);
          console.log(`[NAV] 🧩 Question emitted for Q${index + 1}`);

          requestAnimationFrame(() => {
            this.quizService.updateCorrectAnswersText(banner);
            console.log(`[NAV] 🏷 Banner emitted for Q${index + 1}`);
          });

          resolve();
        } catch (err) {
          console.warn('[NAV] ⚠️ Question emission failed', err);
          qqls._frozen = false;
          qqls._isVisualFrozen = false;
          resolve();
        }
      });
    });

    return { fresh, explanationRaw };
  }

  public async resetUIAndNavigate(
    index: number,
    quizIdOverride?: string
  ): Promise<boolean> {
    try {
      const effectiveQuizId = this.resolveEffectiveQuizId(quizIdOverride);
      if (!effectiveQuizId) {
        console.error(
          '[resetUIAndNavigate] ❌ Cannot navigate without a quizId.',
        );
        return false;
      }

      if (quizIdOverride && this.quizService.quizId !== quizIdOverride) {
        this.quizService.setQuizId(quizIdOverride);
      }

      this.quizId = effectiveQuizId;

      // Always ensure the quiz session is hydrated before attempting to access questions.
      await this.ensureSessionQuestions(effectiveQuizId);

      // Set question index in service so downstream subscribers know what we're targeting.
      this.quizService.setCurrentQuestionIndex(index);

      const question = await this.tryResolveQuestion(index);
      if (question) {
        this.quizService.setCurrentQuestion(question);

        const quiz = this.quizService.getActiveQuiz();
        const totalQuestions = quiz?.questions?.length ?? 0;
        if (totalQuestions > 0) {
          this.quizService.updateBadgeText(index + 1, totalQuestions);
        }
      } else {
        console.warn(
          `[resetUIAndNavigate] ⚠️ Proceeding without a cached question for index ${index}.`
        );
      }

      const routeUrl = `/quiz/question/${effectiveQuizId}/${index + 1}`;
      if (this.router.url === routeUrl) {
        console.warn(`[resetUIAndNavigate] ⚠️ Already on route ${routeUrl}`);
        return true;
      }

      const navSuccess = await this.ngZone.run(() =>
        this.router.navigateByUrl(routeUrl)
      );
      if (!navSuccess) {
        console.error(
          `[resetUIAndNavigate] ❌ Navigation failed for index ${index}`
        );
        return false;
      }

      console.log(
        `[resetUIAndNavigate] ✅ Navigation and UI reset complete for Q${index + 1}`
      );
      return true;
    } catch (err) {
      console.error(`[resetUIAndNavigate] ❌ Error during reset:`, err);
      return false;
    }
  }

  public resolveEffectiveQuizId(quizIdOverride?: string): string | null {
    if (quizIdOverride) {
      this.quizId = quizIdOverride;
      return quizIdOverride;
    }

    if (this.quizService.quizId) {
      this.quizId = this.quizService.quizId;
      return this.quizService.quizId;
    }

    if (this.quizId) return this.quizId;

    const routeQuizId = this.readQuizIdFromRouterSnapshot();
    if (routeQuizId) {
      this.quizId = routeQuizId;
      this.quizService.setQuizId(routeQuizId);
      return routeQuizId;
    }

    try {
      const stored = localStorage.getItem('quizId');
      if (stored) {
        this.quizId = stored;
        this.quizService.setQuizId(stored);
        return stored;
      }
    } catch {
      // Ignore storage access issues – we'll fall through to null.
    }

    return null;
  }

  public async ensureSessionQuestions(quizId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.quizDataService.prepareQuizSession(quizId).pipe(
          take(1),
          catchError((error: Error) => {
            console.error(
              '[resetUIAndNavigate] Failed to prepare quiz session:', error
            );
            return of([]);
          })
        )
      );
    } catch (error) {
      console.error(
        '[resetUIAndNavigate] Error while ensuring session questions:', error
      );
    }
  }

  public async tryResolveQuestion(index: number): Promise<QuizQuestion | null> {
    try {
      return await firstValueFrom(
        this.quizService.getQuestionByIndex(index).pipe(
          catchError((error: Error) => {
            console.error(
              `[resetUIAndNavigate] Failed to resolve question at index ${index}:`,
              error
            );
            return of(null);
          })
        )
      );
    } catch (error) {
      console.error(
        `[resetUIAndNavigate] Question stream did not emit for index ${index}:`,
        error
      );
      return null;
    }
  }

  private resetExplanationAndState(): void {
    // Immediately reset explanation-related state to avoid stale data
    this.explanationTextService.resetExplanationState();
    this.quizStateService.setDisplayState({
      mode: 'question',
      answered: false
    });

    // Clear the old Q&A state before starting navigation
    this.quizQuestionLoaderService.clearQA();
  }

  public notifyNavigationSuccess(): void {
    this.navigationSuccessSubject.next();
  }

  private readQuizIdFromRouterSnapshot(): string | null {
    const direct = this.activatedRoute.snapshot.paramMap.get('quizId');
    if (direct) return direct;

    let snapshot: ActivatedRouteSnapshot | null =
      this.router.routerState.snapshot.root;
    while (snapshot) {
      const value = snapshot.paramMap?.get('quizId');
      if (value) return value;
      snapshot = snapshot.firstChild ?? null;
    }

    return null;
  }

  public resetRenderStateBeforeNavigation(targetIndex: number): void {
    // Shut down all explanation display state immediately
    this.explanationTextService.setShouldDisplayExplanation(false, {
      force: true
    });
    this.explanationTextService.setIsExplanationTextDisplayed(false);
    this.explanationTextService.closeAllGates();

    // Drop any lingering question text
    try {
      this.quizQuestionLoaderService?.questionToDisplaySubject?.next('');
    } catch { }

    // Reset to question mode so next frame starts clean
    this.quizStateService.displayStateSubject.next({
      mode: 'question',
      answered: false
    });
    this.quizStateService.setExplanationReady(false);
  }

  navigateToResults(): void {
    if (this.quizCompleted) {
      console.warn('Navigation to results already completed.');
      return;
    }

    // Ensure we have a robust quizId
    const targetQuizId = this.quizId || this.resolveEffectiveQuizId() || this.quizService.quizId;

    this.quizCompleted = true;
    this.router.navigate([QuizRoutes.RESULTS, targetQuizId]).catch((error) => {
      console.error('Navigation to results failed:', error);
    });
  }

  setIsNavigatingToPrevious(value: boolean): void {
    this.isNavigatingToPrevious.next(value);
  }

  getIsNavigatingToPrevious(): Observable<boolean> {
    return this.isNavigatingToPrevious.asObservable();
  }

  // Reset navigation state when switching quizzes
  resetForNewQuiz(): void {
    console.log('[QuizNavigationService] Resetting for new quiz');
    this.quizCompleted = false;
    this.isNavigating = false;
    this.currentQuestionIndex = 0;
  }
}