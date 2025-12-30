import { Injectable, NgZone } from '@angular/core';
import {
  ActivatedRoute,
  ActivatedRouteSnapshot,
  Router
} from '@angular/router';
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
    question: QuizQuestion;
    options: Option[];
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

  private _fetchInProgress = false; // prevents overlapping question fetches

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
    private ngZone: NgZone,
  ) { }

  public async advanceToNextQuestion(): Promise<boolean> {
    console.log('[NAV CHECKPOINT 1] QuizNavigationService.advanceToNextQuestion called');

    if (this.isNavigating) {
      console.warn('[NAV] ⚠️ advanceToNextQuestion ignored - isNavigating is TRUE');
      return false;
    }

    // DO NOT aggressively reset flags here unless we are sure we are stuck.
    // overly aggressive resetting (setting isNavigating = false immediately) causes race conditions
    // where the button becomes clickable again too soon or state is inconsistent.

    try {
      this.resetExplanationAndState();
    } catch (err) {
      console.warn('[NAV DEBUG] resetExplanationAndState failed, but proceeding', err);
    }

    return await this.navigateWithOffset(1); // defer navigation until state is clean
  }

  public async advanceToPreviousQuestion(): Promise<boolean> {
    // Do not wipe everything; only clear transient display flags if necessary
    try {
      this.quizStateService.setLoading(false);

      // Clear only ephemeral fields (no deep reset)
      (this as any).displayExplanation = false;
      (this as any).explanationToDisplay = '';
      this.explanationTextService.setShouldDisplayExplanation(false);
    } catch (err) {
      console.warn(
        '[NAV] ⚠️ partial reset before previous question failed',
        err,
      );
    }

    return await this.navigateWithOffset(-1);
  }

  private async navigateWithOffset(offset: number): Promise<boolean> {
    console.log(`[NAV FORCE] navigateWithOffset START. Offset: ${offset}`);

    // 1. Get Current Index (Robust URL Parsing)
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

    // 2. Get Quiz ID (best effort, fallback to 'angular-quiz')
    let quizId = this.resolveEffectiveQuizId();
    if (!quizId) {
      console.warn('[NAV FORCE] No quizId found, defaulting to "angular-quiz"');
      quizId = 'angular-quiz';
    }

    // 3. Simple Bounds Safety (only check min)
    if (targetRouteIndex < 1) {
      console.warn('[NAV] Cannot navigate below Q1');
      return false;
    }

    const maxQuestions = this.quizService.questions?.length || 99;

    if (targetRouteIndex > maxQuestions) {
      console.log('[NAV FORCE] Target exceeds max known questions, going to Results');
      await this.ngZone.run(() => this.router.navigate(['/quiz/results', quizId]));
      return true;
    }

    console.log(`[NAV FORCE] Executing direct routing to Q${targetRouteIndex}`);
    // NOTE: navigateToQuestion expects 0-based index, so sub 1
    return this.navigateToQuestion(targetRouteIndex - 1);
  }

  public async navigateToQuestion(index: number): Promise<boolean> {
    // REMOVED _fetchInProgress guard to prevent zombie locks.
    // The UI button state (nextButtonEnabled$) is the primary debounce mechanism.
    this._fetchInProgress = true;

    console.log(`[NAV CHECKPOINT 5] navigateToQuestion START. Index: ${index}`);

    try {
      // 1. Set navigating state
      this.isNavigating = true;
      this.quizStateService.setNavigating(true);
      this.quizStateService.setLoading(true);

      // 2. Perform Router Navigation
      const navSuccess = await this.performRouterNavigation(index);
      if (!navSuccess) {
        console.error('[NAV] Router navigation failed');
        return false;
      }

      // 3. Update Service State (Index) - CRITICAL: Update AFTER router nav success
      this.quizService.setCurrentQuestionIndex(index);
      this.currentQuestionIndex = index;

      // 4. Reset UI States for New Question
      this.resetExplanationAndState();
      this.selectedOptionService.setAnswered(false, true);
      // 🔑 FIXED: Clear all option selections when navigating to new question
      this.selectedOptionService.resetAllStates?.();
      this.selectedOptionService.clearSelectionsForQuestion?.(index);
      this.nextButtonStateService.reset();
      this.quizQuestionLoaderService.resetUI();


      // 5. Fetch New Question Data
      const fresh = await this.fetchAndEmitQuestion(index);
      if (!fresh) {
        console.error('[NAV] Failed to fetch new question data');
        return false;
      }

      // 6. Finalize
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

  private async prepareNavigationState(index: number): Promise<void> {
    this.quizStateService.isNavigatingSubject.next(true);
    const prevIndex = this.quizService.getCurrentQuestionIndex() - 1;

    // RESET & LOCK FET GATES
    try {
      const ets: any = this.explanationTextService;
      if (prevIndex >= 0) ets.closeGateForIndex(prevIndex);
      ets._byIndex?.forEach?.((s$: any) => s$?.next?.(null));
      ets.formattedExplanationSubject.next('');
      ets.setShouldDisplayExplanation(false);
      ets.setIsExplanationTextDisplayed(false);

      ets._fetGateLockUntil = performance.now() + 120;
      console.log(`[NAV] 🧱 FET gates locked for 120 ms (prev=${prevIndex})`);
    } catch (err) {
      console.warn('[NAV] ⚠️ FET lock reset failed', err);
    }

    // FREEZE BEFORE CLEARING ANYTHING
    this.quizQuestionLoaderService.freezeQuestionStream(96);
    this.quizQuestionLoaderService._lastNavTime = performance.now();
    this.quizQuestionLoaderService.clearQuestionTextBeforeNavigation();
    this.resetRenderStateBeforeNavigation(index);

    // Allow Angular to paint first
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => setTimeout(r, 32));

    // Reinforce mute briefly after Angular repaint
    const ets2: any = this.explanationTextService;
    ets2._hardMuteUntil = performance.now() + 48;
    ets2.formattedExplanationSubject.next('');
    ets2.setShouldDisplayExplanation(false);
    ets2.setIsExplanationTextDisplayed(false);

    // Validate quizId
    const quizIdFromRoute = this.activatedRoute.snapshot.paramMap.get('quizId');
    const fallbackQuizId = localStorage.getItem('quizId');
    const quizId = quizIdFromRoute || fallbackQuizId;

    if (!quizId || quizId === 'fallback-id')
      console.error('[❌ Invalid quizId – fallback used]', quizId);

    // Timer flags, locks
    const currentIndex = this.quizService.getCurrentQuestionIndex();
    this.quizQuestionLoaderService.resetQuestionLocksForIndex(currentIndex);
    this.timerService.resetTimerFlagsFor(index);
  }

  private async performRouterNavigation(index: number): Promise<boolean> {
    const quizIdFromRoute = this.activatedRoute.snapshot.paramMap.get('quizId');
    const fallbackQuizId = localStorage.getItem('quizId');
    const quizId = quizIdFromRoute || fallbackQuizId;

    const routeUrl = `/quiz/question/${quizId}/${index + 1}`;
    console.log(`[NAV DEBUG] performRouterNavigation START. Target: ${routeUrl}`);
    const currentUrl = this.router.url;
    const currentIndex = this.quizService.getCurrentQuestionIndex();

    // Handle same-URL reload scenario
    if (currentIndex === index && currentUrl === routeUrl) {
      console.log('[NAV DEBUG] Same URL detected. Reloading root first.');
      await this.ngZone.run(() =>
        this.router.navigateByUrl('/', { skipLocationChange: true }),
      );
    }

    const navSuccess = await this.ngZone.run(() =>
      this.router.navigateByUrl(routeUrl),
    );
    console.log(`[NAV DEBUG] router.navigateByUrl result: ${navSuccess}`);

    if (!navSuccess) {
      console.warn('[⚠️ Router navigateByUrl returned false]', routeUrl);
      return false;
    }

    return true;
  }

  private async resetPostNavigationState(index: number): Promise<void> {
    // RESET SELECTIONS
    this.selectedOptionService.resetAllStates?.();
    (this.selectedOptionService as any)._lockedOptionsMap?.clear?.();
    (this.selectedOptionService as any).optionStates?.clear?.();
    this.selectedOptionService.selectedOptionsMap?.clear?.();
    this.selectedOptionService.clearSelectionsForQuestion(
      this.currentQuestionIndex,
    );

    // Silence ETS
    const ets: any = this.explanationTextService;
    ets._activeIndex = -1;
    ets._transitionLock = true;
    ets.latestExplanation = '';
    ets.setShouldDisplayExplanation(false);
    ets.setIsExplanationTextDisplayed(false);
    ets.formattedExplanationSubject.next('');

    setTimeout(() => {
      ets._transitionLock = false;
    }, 180);
  }

  private async fetchAndEmitQuestion(index: number): Promise<any> {
    const fresh = await firstValueFrom(
      this.quizService.getQuestionByIndex(index),
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

      console.log(
        `[NAV] 🚿 Purged all stale FET for old indices — aligned to Q${index + 1}`,
      );
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
        totalOpts,
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

  private armExplanationText(index: number, data: any): void {
    const { fresh, explanationRaw } = data;
    const ets: any = this.explanationTextService;

    if (!explanationRaw) return;

    const correctIdxs = ets.getCorrectOptionIndices(fresh as any);
    const formatted = ets
      .formatExplanation(fresh as any, correctIdxs, explanationRaw)
      .trim();

    setTimeout(() => {
      const nowAfter = performance.now();
      const stillQuiet = nowAfter < (ets._quietZoneUntil ?? 0);

      if (!stillQuiet) {
        ets.openExclusive(index, formatted);
        ets.setShouldDisplayExplanation(false, { force: false });
        console.log(`[NAV] 🧩 FET armed post-paint for Q${index + 1}`);
      } else {
        console.log('[NAV] ⏸ FET skipped due to quiet zone still active');
      }
    }, 120);
  }

  private async finalizeNavigation(ets: any, qqls: any): Promise<void> {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        this.quizStateService.isNavigatingSubject.next(false);
        resolve();
      }),
    );

    const endNow = performance.now();
    qqls._quietZoneUntil = endNow + 40;
    ets._quietZoneUntil = endNow + 40;

    ets.markLastNavTime?.(endNow);
    qqls._lastNavTime = endNow;
  }

  public async resetUIAndNavigate(
    index: number,
    quizIdOverride?: string,
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
          `[resetUIAndNavigate] ⚠️ Proceeding without a cached question for index ${index}.`,
        );
      }

      const routeUrl = `/quiz/question/${effectiveQuizId}/${index + 1}`;
      if (this.router.url === routeUrl) {
        console.warn(`[resetUIAndNavigate] ⚠️ Already on route ${routeUrl}`);
        return true;
      }

      const navSuccess = await this.ngZone.run(() =>
        this.router.navigateByUrl(routeUrl),
      );
      if (!navSuccess) {
        console.error(
          `[resetUIAndNavigate] ❌ Navigation failed for index ${index}`,
        );
        return false;
      }

      console.log(
        `[resetUIAndNavigate] ✅ Navigation and UI reset complete for Q${index + 1}`,
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
              '[resetUIAndNavigate] ❌ Failed to prepare quiz session:',
              error,
            );
            return of([]);
          }),
        ),
      );
    } catch (error) {
      console.error(
        '[resetUIAndNavigate] ❌ Error while ensuring session questions:',
        error,
      );
    }
  }

  public async tryResolveQuestion(index: number): Promise<QuizQuestion | null> {
    try {
      return await firstValueFrom(
        this.quizService.getQuestionByIndex(index).pipe(
          catchError((error: Error) => {
            console.error(
              `[resetUIAndNavigate] ❌ Failed to resolve question at index ${index}:`,
              error,
            );
            return of(null);
          }),
        ),
      );
    } catch (error) {
      console.error(
        `[resetUIAndNavigate] ❌ Question stream did not emit for index ${index}:`,
        error,
      );
      return null;
    }
  }

  private resetExplanationAndState(): void {
    console.log('[NAV DEBUG] resetExplanationAndState called');
    // Immediately reset explanation-related state to avoid stale data
    this.explanationTextService.resetExplanationState();
    this.quizStateService.setDisplayState({
      mode: 'question',
      answered: false,
    });

    // Clear the old Q&A state before starting navigation
    this.quizQuestionLoaderService.clearQA();
  }

  /**
   * TODO: Re-enable when results/score submission flow is finalized.
   * Currently unused, but will be required when integrating full results routing.
   */
  /* private handleQuizCompletion(): void {
    const quizId = this.quizService.quizId;
    
    this.quizService.submitQuizScore(this.answers).subscribe({
      next: () => {
        console.log('Score submitted.');
        this.ngZone.run(() => this.router.navigate(['results', quizId]));
      },
      error: (err) => {
        console.error('[❌ Error submitting score]', err);
      }
    });
  } */

  public notifyNavigationSuccess(): void {
    this.navigationSuccessSubject.next();
  }

  private notifyNavigatingBackwards(): void {
    this.navigatingBackSubject.next(true);
  }

  private notifyResetExplanation(): void {
    this.explanationResetSubject.next();
  }

  /**
   * TODO: Keep for future navigation/analytics/event-bus integration.
   * Currently unused, but will be required when emitting question-navigation events.
   */
  /* emitNavigationToQuestion(question: QuizQuestion, options: Option[]): void {
    this.navigationToQuestionSubject.next({ question, options });
  } */

  /**
   * TODO: Keep for future navigation synchronization.
   * This will be needed when coordinating async route changes,
   * dynamic component loading, and explanation/option rendering.
   * Currently unused, but intentionally preserved.
   */
  /* private waitForUrl(url: string): Promise<string> {
    const target = this.normalizeUrl(url);
  
    return new Promise<string>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        subscription.unsubscribe();
        console.warn(`[waitForUrl] ⏰ Timeout waiting for ${target}`);
        resolve(target);  // fallback resolve after 1s to prevent hang
      }, 1000);
  
      const subscription = this.router.events.subscribe({
        next: (event) => {
          if (event instanceof NavigationEnd) {
            const finalUrl = this.normalizeUrl(event.urlAfterRedirects || event.url);
  
            if (finalUrl.includes(target)) {
              clearTimeout(timeoutId);
              subscription.unsubscribe();
              console.log(`[waitForUrl] ✅ Resolved: ${finalUrl}`);
              resolve(finalUrl);
            }
          }
  
          if (event instanceof NavigationCancel || event instanceof NavigationError) {
            clearTimeout(timeoutId);
            subscription.unsubscribe();
            console.warn(`[waitForUrl] ⚠️ Navigation failed/cancelled for ${target}`);
            reject(new Error(`Navigation to ${target} failed.`));
          }
        },
        error: (err) => {
          clearTimeout(timeoutId);
          subscription.unsubscribe();
          reject(err);
        }
      });
    });
  } */

  /**
   * TODO: Remains intentionally unused for now.
   * Required by future route-sync helpers (e.g., waitForUrl).
   * Normalizes and safely parses router URLs to prevent
   * mismatch during async navigation events.
   */
  /* private normalizeUrl(url: string): string {
    if (!url) return '';

    try {
      const serialized = this.router.serializeUrl(this.router.parseUrl(url));
      return serialized.startsWith('/') ? serialized : `/${serialized}`;
    } catch {
      return url.startsWith('/') ? url : `/${url}`;
    }
  } */

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

  private async resolveTotalQuestions(quizId: string): Promise<number> {
    const loaderCount = this.quizQuestionLoaderService.totalQuestions;
    if (Number.isFinite(loaderCount) && loaderCount > 0) return loaderCount;

    const cachedArrayCount =
      this.quizQuestionLoaderService.questionsArray?.length ?? 0;
    if (cachedArrayCount > 0) {
      this.quizQuestionLoaderService.totalQuestions = cachedArrayCount;
      return cachedArrayCount;
    }

    try {
      const cachedCount = await firstValueFrom(
        this.quizService.totalQuestions$.pipe(take(1)),
      );
      if (Number.isFinite(cachedCount) && cachedCount > 0) return cachedCount;
    } catch {
      // ignore and fall through to fetch
    }

    try {
      const fetchedCount = await firstValueFrom(
        this.quizService.getTotalQuestionsCount(quizId).pipe(take(1)),
      );
      if (Number.isFinite(fetchedCount) && fetchedCount > 0) {
        this.quizQuestionLoaderService.totalQuestions = fetchedCount;
        this.quizService.setTotalQuestions(fetchedCount);
        return fetchedCount;
      }
    } catch (error) {
      console.error('[❌ resolveTotalQuestions] Failed to fetch count', {
        quizId,
        error,
      });
    }

    return 0;
  }

  private setQuestionReadyAfterDelay(): void {
    this.questionReady = false;
    requestAnimationFrame(() => {
      this.questionReady = true; // question reveal triggered
    });
  }

  public resetRenderStateBeforeNavigation(targetIndex: number): void {
    // Shut down all explanation display state immediately
    this.explanationTextService.setShouldDisplayExplanation(false, {
      force: true,
    });
    this.explanationTextService.setIsExplanationTextDisplayed(false);
    this.explanationTextService.closeAllGates?.();

    // Drop any lingering question text
    try {
      this.quizQuestionLoaderService?.questionToDisplaySubject?.next('');
    } catch { }

    // Reset to question mode so next frame starts clean
    this.quizStateService.displayStateSubject?.next({
      mode: 'question',
      answered: false,
    });
    this.quizStateService.setExplanationReady(false);

    console.log(
      `[RESET] Render state cleared before navigating → Q${targetIndex + 1}`,
    );
  }

  navigateToResults(): void {
    if (this.quizCompleted) {
      console.warn('Navigation to results already completed.');
      return;
    }

    this.quizCompleted = true;
    this.router.navigate([QuizRoutes.RESULTS, this.quizId]).catch((error) => {
      console.error('Navigation to results failed:', error);
    });
  }

  setIsNavigatingToPrevious(value: boolean): void {
    this.isNavigatingToPrevious.next(value);
  }

  getIsNavigatingToPrevious(): Observable<boolean> {
    return this.isNavigatingToPrevious.asObservable();
  }
}
