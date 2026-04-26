import { Injectable } from '@angular/core';
import { ActivatedRoute, NavigationEnd, ParamMap, Params, Router } from '@angular/router';
import { combineLatest, EMPTY, firstValueFrom, of } from 'rxjs';
import {
  catchError, debounceTime, distinctUntilChanged, filter, map, shareReplay, startWith, switchMap, takeUntil, tap
} from 'rxjs/operators';

import { QuizPersistenceService } from '../state/quiz-persistence.service';
import { QuizOptionProcessingService } from './quiz-option-processing.service';
import { SelectionMessageService } from '../features/selection-message/selection-message.service';
import { SharedVisibilityService } from '../ui/shared-visibility.service';
import { QuizVisibilityRestoreService } from './quiz-visibility-restore.service';

import { Quiz } from '../../models/Quiz.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { Option } from '../../models/Option.model';
import { QuestionPayload } from '../../models/QuestionPayload.model';

import { QuizService } from '../data/quiz.service';
import { QuizDataService } from '../data/quizdata.service';
import { QuizStateService } from '../state/quizstate.service';
import { TimerService } from '../features/timer/timer.service';
import { ExplanationTextService } from '../features/explanation/explanation-text.service';
import { NextButtonStateService } from '../state/next-button-state.service';
import { SelectedOptionService } from '../state/selectedoption.service';
import { QuizDotStatusService } from './quiz-dot-status.service';
import { QuizQuestionDataService } from './quiz-question-data.service';
import { QuizContentLoaderService } from './quiz-content-loader.service';
import { QuizResetService } from './quiz-reset.service';
import { QuizRouteService } from './quiz-route.service';
import { QuizNavigationService } from './quiz-navigation.service';

type Host = any;

/**
 * Hosts orchestration / route / lifecycle logic extracted from QuizComponent.
 * Methods take a `host` reference to access the component's state and services.
 */
@Injectable({ providedIn: 'root' })
export class QuizSetupService {
  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private quizStateService: QuizStateService,
    private timerService: TimerService,
    private explanationTextService: ExplanationTextService,
    private nextButtonStateService: NextButtonStateService,
    private selectedOptionService: SelectedOptionService,
    private dotStatusService: QuizDotStatusService,
    private quizQuestionDataService: QuizQuestionDataService,
    private quizContentLoaderService: QuizContentLoaderService,
    private quizResetService: QuizResetService,
    private quizRouteService: QuizRouteService,
    private quizNavigationService: QuizNavigationService,
    private quizPersistence: QuizPersistenceService,
    private quizOptionProcessingService: QuizOptionProcessingService,
    private selectionMessageService: SelectionMessageService,
    private sharedVisibilityService: SharedVisibilityService,
    private quizVisibilityRestoreService: QuizVisibilityRestoreService,
    private router: Router
  ) {}

  // ── Constructor wiring (subscriptions + observables) ──────────
  wireConstructor(host: Host): void {
    if (host.quizQuestionComponent) host.quizQuestionComponent.renderReady = false;

    this.sharedVisibilityService.pageVisibility$.subscribe((isHidden: boolean) => {
      const needsRender = this.quizVisibilityRestoreService.handleVisibilityChange(isHidden, {
        currentQuestion: host.currentQuestion,
        optionsToDisplay: host.optionsToDisplay,
        explanationToDisplay: host.explanationToDisplay,
        combinedQuestionDataSubject: host.combinedQuestionDataSubject,
        optionsToDisplay$: host.optionsToDisplay$,
      });
      if (needsRender) {
        host.cdRef.markForCheck();
      }

      // When tab becomes visible, ensure question text is in the <h3>
      if (!isHidden) {
        const idx = host.currentQuestionIndex;
        const question = this.quizService.questions?.[idx]
          ?? host.questionsArray?.[idx]
          ?? null;
        if (question) {
          const displayHTML = this.buildQuestionDisplayHTML(question);
          if (displayHTML) {
            const writeH3 = () => {
              try {
                const h3 = document.querySelector('codelab-quiz-content h3');
                if (h3 && !h3.innerHTML.trim()) {
                  h3.innerHTML = displayHTML;
                }
              } catch {}
            };
            setTimeout(writeH3, 50);
            setTimeout(writeH3, 200);
            setTimeout(writeH3, 500);
            setTimeout(writeH3, 1000);
          }
        }
      }
    });

    host.isAnswered$ = this.selectedOptionService.isAnswered$;
    host.selectionMessage$ = this.selectionMessageService.selectionMessage$;

    host.subscriptions.add(
      this.quizService.quizReset$.subscribe(() => this.refreshQuestionOnReset(host))
    );

    host.subscriptions.add(
      this.quizService.questions$.subscribe((questions: QuizQuestion[]) => {
        const serviceQuizId = this.quizService.getCurrentQuizId();
        if (questions?.length && (!host.quizId || serviceQuizId === host.quizId)) {
          // When shuffle is active, ALWAYS use shuffledQuestions as the
          // authoritative source. questionsSubject can receive unshuffled
          // data from setActiveQuiz/syncSelectedQuizState which would
          // poison host.questionsArray and cause Q&A mismatches.
          const shuffled = this.quizService.shuffledQuestions;
          const effectiveQuestions =
            this.quizService.isShuffleEnabled() && shuffled?.length > 0
              ? shuffled
              : questions;
          host.questions = effectiveQuestions;
          host.questionsArray = [...effectiveQuestions];
          host.totalQuestions = effectiveQuestions.length;
          host.cdRef.markForCheck();
        }
      })
    );

    host.isButtonEnabled$ = this.selectedOptionService
      .isOptionSelected$()
      .pipe(debounceTime(300), shareReplay(1));

    this.selectedOptionService.isNextButtonEnabled$.subscribe((enabled: boolean) => {
      host.isNextButtonEnabled = enabled;
    });

    this.selectedOptionService.isOptionSelected$().subscribe((isSelected: boolean) => {
      host.isCurrentQuestionAnswered = isSelected;
      host.cdRef.markForCheck();
    });

    this.selectedOptionService.selectedOption$.subscribe((selections: any[]) => {
      const qIndex = selections?.[0]?.questionIndex ?? host.currentQuestionIndex;
      if (selections && selections.length > 0) host.markQuestionAnswered(qIndex);
      host.updateDotStatus(qIndex);
      host.cdRef.detectChanges();
    });

    this.quizService.currentQuestion.subscribe({
      next: (newQuestion: QuizQuestion | null) => {
        if (!newQuestion) return;
        host.currentQuestion = null;
        setTimeout(() => { host.currentQuestion = { ...newQuestion }; }, 10);
      },
      error: (error: Error) => console.error('currentQuestion subscription:', error)
    });

    host.isContentAvailable$ = this.quizDataService.isContentAvailable$;
  }

  // ── onOptionSelected ──────────────────────────────────────────
  async onOptionSelected(host: Host, option: any, isUserAction: boolean = true): Promise<void> {
    if (!isUserAction) return;
    const id = option?.optionId ?? option?.id ?? option?.displayOrder ?? -1;
    const now = Date.now();
    if (id !== -1 && id === (host._lastOptionId ?? -1) && (now - (host._lastClickTime ?? 0)) < 200) return;
    host._lastClickTime = now;
    host._lastOptionId = id;

    host._processingOptionClick = true;
    const idx = host.normalizeQuestionIndex(option?.questionIndex);

    // Only show explanation immediately for single-answer questions
    // when the clicked option is CORRECT. For multi-answer, FET must
    // wait until ALL correct answers are selected.
    // SHUFFLED FIX: quizService.questions[idx] is original order — use
    // display-order source so the multi-answer check uses the right question.
    const _isShuf = (this.quizService as any)?.isShuffleEnabled?.()
      && (this.quizService as any)?.shuffledQuestions?.length > 0;
    const authQ = _isShuf
      ? ((this.quizService as any)?.getQuestionsInDisplayOrder?.()?.[idx]
        ?? (this.quizService as any)?.shuffledQuestions?.[idx]
        ?? host.currentQuestion)
      : (this.quizService.questions?.[idx] ?? host.currentQuestion);
    const correctCount = (authQ?.options ?? []).filter(
      (o: any) => o?.correct === true || o?.correct === 1 || String(o?.correct) === 'true'
    ).length;
    const isMultiAnswer = correctCount > 1 || this.quizService.multipleAnswer;

    // For single-answer, only show explanation if the clicked option is
    // actually correct (pristine check). Without this, every click —
    // including incorrect ones — triggers FET display.
    let clickedIsCorrectForFET = false;
    if (!isMultiAnswer) {
      try {
        const nrmF = (t: any) => String(t ?? '').trim().toLowerCase();
        const clickedText = nrmF(option?.text);
        const qTextF = nrmF(authQ?.questionText);
        if (clickedText && qTextF) {
          const bundleF: any[] = (this.quizService as any)?.quizInitialState ?? [];
          for (const quiz of bundleF) {
            let found = false;
            for (const pq of (quiz?.questions ?? [])) {
              if (nrmF(pq?.questionText) !== qTextF) continue;
              const mo = (pq?.options ?? []).find((o: any) => nrmF(o?.text) === clickedText);
              if (mo) {
                clickedIsCorrectForFET = mo?.correct === true || String(mo?.correct) === 'true';
              }
              found = true;
              break;
            }
            if (found) break;
          }
        }
      } catch { /* ignore */ }
    }
    if (!isMultiAnswer && clickedIsCorrectForFET) {
      this.showExplanationForQuestion(host, idx);
    }

    await this.quizOptionProcessingService.processOptionClick({
      option, idx, quizId: host.quizId,
      currentQuestionIndex: host.currentQuestionIndex,
      questionsArray: host.questionsArray,
      currentQuestion: host.currentQuestion,
      optionsToDisplay: host.optionsToDisplay,
      liveSelections: host.getSelectionsForQuestion(idx),
      explanationToDisplay: host.explanationToDisplay,
    });

    host.markQuestionAnswered(idx);
    host.updateDotStatus(idx);

    // Persist dot status to localStorage so it survives refresh.
    // Use clickConfirmedDotStatus (set during click) as the source of truth,
    // since dotStatusCache may still be 'pending' at this point.
    const confirmed = this.selectedOptionService.clickConfirmedDotStatus.get(idx);
    const dotStatus = confirmed || this.dotStatusService.dotStatusCache.get(idx);
    if (dotStatus === 'correct' || dotStatus === 'wrong') {
      this.quizPersistence.setPersistedDotStatus(host.quizId, idx, dotStatus);
    }

    host.cdRef.detectChanges();
    host._processingOptionClick = false;

    setTimeout(() => {
      this.nextButtonStateService.evaluateNextButtonState(
        this.selectedOptionService.isAnsweredSig(),
        this.quizStateService.isLoadingSig(),
        this.quizStateService.isNavigatingSig()
      );
      host.updateDotStatus(idx);
      // Persist dot status to localStorage so it survives refresh
      const delayedDotStatus = this.dotStatusService.dotStatusCache.get(idx);
      if (delayedDotStatus === 'correct' || delayedDotStatus === 'wrong') {
        this.quizPersistence.setPersistedDotStatus(host.quizId, idx, delayedDotStatus);
      }
      host.cdRef.detectChanges();
    }, 150);
  }

  // ── advanceQuestion / restartQuiz ─────────────────────────────
  async advanceQuestion(host: Host, direction: 'next' | 'previous'): Promise<void> {
    this.quizContentLoaderService.snapshotLeavingQuestion({
      leavingIdx: host.currentQuestionIndex,
      leavingDotClass: host.getDotClass(host.currentQuestionIndex),
      quizId: host.quizId,
      getScoringKey: (idx: number) => this.dotStatusService.getScoringKey(host.quizId, idx),
    });
    const leavingDotClass = host.getDotClass(host.currentQuestionIndex);
    if (leavingDotClass.includes('correct')) this.quizPersistence.setPersistedDotStatus(host.quizId, host.currentQuestionIndex, 'correct');
    else if (leavingDotClass.includes('wrong')) this.quizPersistence.setPersistedDotStatus(host.quizId, host.currentQuestionIndex, 'wrong');
    host.animationState$.next('animationStarted');
    this.selectedOptionService.setAnswered(false);
    this.quizStateService.resetInteraction();
    if (direction === 'next') {
      const destIndex = host.currentQuestionIndex + 1;
      if (destIndex < host.totalQuestions) {
        this.dotStatusService.clearForIndex(destIndex);
        this.selectedOptionService.lastClickedCorrectByQuestion.delete(destIndex);
        this.selectedOptionService.clickConfirmedDotStatus.delete(destIndex);
        this.quizPersistence.clearPersistedDotStatus(host.quizId, destIndex);
        try { sessionStorage.removeItem('dot_confirmed_' + destIndex); } catch {}
      }
    }
    if (direction === 'next') await this.quizNavigationService.advanceToNextQuestion();
    else await this.quizNavigationService.advanceToPreviousQuestion();
    host.cdRef.markForCheck();
  }

  restartQuiz(host: Host): void {
    this.quizResetService.performRestartServiceResets(host.quizId, host.totalQuestions);
    this.dotStatusService.clearAllMaps();
    host.quizQuestionComponent?.selectedIndices?.clear();
    this.timerService.stopTimer?.(undefined, { force: true });
    host.answeredQuestionIndices.clear();
    host.progress = 0;
    this.quizPersistence.clearClickConfirmedDotStatus(host.totalQuestions);

    // Clear all session-persisted selection/interaction state so options
    // don't auto-highlight and question text displays after restart.
    try {
      for (let i = 0; i < host.totalQuestions; i++) {
        sessionStorage.removeItem('sel_Q' + i);
      }
      sessionStorage.removeItem('answeredQuestionIndices');
    } catch {}
    try {
      this.quizStateService._hasUserInteracted?.clear?.();
      this.quizStateService._answeredQuestionIndices?.clear?.();
      (this.quizStateService as any)._clickedInSession?.clear?.();
      (this.quizStateService as any).persistInteractionState?.();
    } catch {}

    this.router.navigate(['/quiz/question', host.quizId, 1])
      .then(() => {
        host.currentQuestionIndex = 0;
        this.quizResetService.applyPostRestartState(host.totalQuestions, () => {
          host.sharedOptionComponent?.generateOptionBindings();
          host.cdRef.detectChanges();
        });

        // Force question text into <h3> after restart navigation
        const question = this.quizService.questions?.[0]
          ?? host.questionsArray?.[0]
          ?? null;
        if (question) {
          const displayHTML = this.buildQuestionDisplayHTML(question);
          if (displayHTML) {
            const writeH3 = () => {
              try {
                const h3 = document.querySelector('codelab-quiz-content h3');
                if (h3 && !h3.innerHTML.trim()) {
                  h3.innerHTML = displayHTML;
                }
              } catch {}
            };
            setTimeout(writeH3, 50);
            setTimeout(writeH3, 200);
            setTimeout(writeH3, 500);
          }
        }
      })
      .catch((error: Error) => console.error('Navigation error on restart:', error));
  }

  // ── Route events ──────────────────────────────────────────────
  subscribeToRouteEvents(host: Host): void {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(async () => {
        const { routeQuizId, index: idx, isQuizSwitch } =
          this.quizRouteService.parseNavigationEndParams(host.activatedRoute, host.quizId);

        if (isQuizSwitch && routeQuizId) {
          this.quizNavigationService.resetForNewQuiz();
          this.quizResetService.performQuizSwitchResets(routeQuizId);
          this.resetComponentStateForQuizSwitch(host, routeQuizId);
          await this.loadQuestions(host);
          host.isQuizLoaded = true;
        }

        host.currentQuestionIndex = idx;
        this.quizService.setCurrentQuestionIndex(idx);
        host.updateDotStatus(idx);

        // Force-update combinedQuestionDataSubject so the template always
        // has question data after URL navigation. Prefer quizService.questions
        // getter which returns shuffled data when shuffle is active.
        const question = this.quizService.questions?.[idx]
          ?? host.questionsArray?.[idx]
          ?? null;
        if (question && question.options?.length > 0) {
          const payload = {
            question,
            options: question.options,
            explanation: question.explanation,
          };
          host.combinedQuestionDataSubject.next(payload);
          host.questionToDisplaySource.next(question.questionText?.trim() ?? '');
          host.cdRef.detectChanges();

          // Force question text (with multi-answer banner) into <h3 #qText>
          const displayHTML = this.buildQuestionDisplayHTML(question);
          if (displayHTML) {
            const writeH3 = () => {
              try {
                const h3 = document.querySelector('codelab-quiz-content h3');
                if (h3 && !h3.innerHTML.trim()) {
                  h3.innerHTML = displayHTML;
                }
              } catch {}
            };
            setTimeout(writeH3, 0);
            setTimeout(writeH3, 100);
            setTimeout(writeH3, 300);
            setTimeout(writeH3, 600);
          }

          // Retry after microtask to ensure child components have rendered
          Promise.resolve().then(() => {
            host.combinedQuestionDataSubject.next(payload);
            host.cdRef.detectChanges();
          });
        }
      });
  }

  private resetComponentStateForQuizSwitch(host: Host, routeQuizId: string): void {
    host.questionsArray = [];
    host.currentQuestion = null;
    host.optionsToDisplay = [];
    host.optionsToDisplay$.next([]);
    host.combinedQuestionDataSubject.next(null);
    host.questionToDisplaySource.next('');
    host.explanationToDisplay = '';
    host.currentQuestionIndex = 0;
    host.lastLoggedIndex = -1;
    host.navigatingToResults = false;
    host.isQuizLoaded = false;
    host.isQuizDataLoaded = false;
    host.totalQuestions = 0;
    host.progress = 0;
    host.quizId = routeQuizId;
    this.quizService.setQuizId(routeQuizId);
  }

  fetchTotalQuestions(host: Host): void {
    this.quizService.getTotalQuestionsCount(host.quizId)
      .pipe()
      .subscribe((total: number) => {
        host.totalQuestions = total;
        host.cdRef.markForCheck();
      });
  }

  subscribeToQuestionIndex(host: Host): void {
    host.indexSubscription = this.quizService.currentQuestionIndex$
      .pipe(distinctUntilChanged())
      .subscribe((idx: number) => {
        const prevIdx = host.lastLoggedIndex;
        host.lastLoggedIndex = idx;
        host.currentQuestionIndex = idx;

        console.log(`[subscribeToQuestionIndex] idx=${idx}, prevIdx=${prevIdx}, questionsArray.length=${host.questionsArray?.length}`);
        const { question, isNavigation } = this.quizContentLoaderService.handleQuestionIndexTransition({
          idx, prevIdx, quizId: host.quizId, questionsArray: host.questionsArray,
        });
        console.log(`[subscribeToQuestionIndex] question=${!!question}, questionText="${question?.questionText?.substring(0, 50)}", isNavigation=${isNavigation}`);

        if (question) {
          host.currentQuestion = question;
          host.questionToDisplaySource.next(question.questionText?.trim() ?? '');
          host.combinedQuestionDataSubject.next({
            question, options: question.options, explanation: question.explanation,
          });
          console.log(`[subscribeToQuestionIndex] EMITTED to combinedQuestionDataSubject, options=${question.options?.length}`);
        } else {
          console.warn(`[subscribeToQuestionIndex] NO QUESTION for idx=${idx} in questionsArray of length ${host.questionsArray?.length}`);
        }
        host.cdRef.markForCheck();

        if (isNavigation) {
          host.explanationToDisplay = '';
          host.optionsToDisplay = [];
          host.updateDotStatus(idx);
        }
        // Nuclear clear: wipe ALL locks on navigation so disable state
        // from any prior question can't leak into the new one.
        try {
          const sos: any = this.selectedOptionService;
          sos._lockedByQuestion?.clear?.();
          sos._questionLocks?.clear?.();
          const sms: any = this.selectionMessageService;
          sms._singleAnswerCorrectLock?.clear?.();
          sms._singleAnswerIncorrectLock?.clear?.();
          sms._multiAnswerInProgressLock?.clear?.();
          sms._multiAnswerCompletionLock?.clear?.();
          sms._multiAnswerPreLock?.clear?.();
        } catch {}

        // Start the timer on both initial load and navigation (unless answered)
        if (!this.selectedOptionService.isQuestionAnswered(idx)) {
          this.timerService.restartForQuestion(idx);
        }
      });
  }

  /**
   * Build question display HTML including the multi-answer banner.
   * Uses pristine quizInitialState for accurate correct-answer count.
   */
  private buildQuestionDisplayHTML(question: QuizQuestion): string {
    const rawQ = (question.questionText ?? '').trim();
    if (!rawQ) return '';

    const opts = question.options ?? [];
    let numCorrect = opts.filter((o: Option) => o?.correct === true).length;

    // Cross-check against pristine data for accurate count
    try {
      const nrm = (t: any) => String(t ?? '').trim().toLowerCase();
      const qText = nrm(rawQ);
      const bundle: any[] = (this.quizService as any)?.quizInitialState ?? [];
      for (const quiz of bundle) {
        for (const pq of (quiz?.questions ?? [])) {
          if (nrm(pq?.questionText) !== qText) continue;
          const pc = (pq?.options ?? []).filter(
            (o: any) => o?.correct === true || String(o?.correct) === 'true'
          ).length;
          if (pc > numCorrect) numCorrect = pc;
          break;
        }
        if (numCorrect > 1) break;
      }
    } catch {}

    if (numCorrect > 1 && opts.length > 0) {
      const pluralSuffix = numCorrect === 1 ? 'answer is' : 'answers are';
      const banner = `(${numCorrect} ${pluralSuffix} correct)`;
      return `${rawQ} <span class="correct-count">${banner}</span>`;
    }
    return rawQ;
  }

  /**
   * Bridge: forward quizService.questionPayload$ emissions to
   * host.combinedQuestionDataSubject so URL navigation always
   * updates the quiz card template (which gates on combinedQuestionData$).
   */
  private bridgeQuestionPayload(host: Host): void {
    this.quizService.questionPayload$
      .pipe(
        filter((p): p is QuestionPayload => !!p && !!p.question && Array.isArray(p.options) && p.options.length > 0)
      )
      .subscribe((payload) => {
        host.combinedQuestionDataSubject.next(payload);
        host.questionToDisplaySource.next(payload.question.questionText?.trim() ?? '');
        host.cdRef.markForCheck();
      });
  }

  async loadQuestions(host: Host): Promise<void> {
    try {
      const questions = await this.quizService.fetchQuizQuestions(host.quizId);
      if (!questions?.length) return;
      host.questionsArray = [...questions];
      host.totalQuestions = questions.length;
      host.isQuizDataLoaded = true;
      host.cdRef.detectChanges();
    } catch (error) {
      console.error('[loadQuestions]', error);
    }
    this.pushInitialQuestionPayload(host);
  }

  private pushInitialQuestionPayload(host: Host): void {
    const initialIdx = host.currentQuestionIndex || 0;
    const initialQuestion = this.quizService.questions?.[initialIdx]
      ?? host.questionsArray?.[initialIdx];
    if (!initialQuestion?.options?.length) return;

    host.currentQuestion = initialQuestion;
    host.questionToDisplaySource.next(initialQuestion.questionText?.trim() ?? '');
    const payload = {
      question: initialQuestion,
      options: initialQuestion.options,
      explanation: initialQuestion.explanation
    };
    host.combinedQuestionDataSubject.next(payload);
    host.cdRef.detectChanges();

    Promise.resolve().then(() => {
      const current = host.combinedQuestionDataSubject.getValue();
      if (!current || current.options?.length === 0) {
        host.combinedQuestionDataSubject.next(payload);
        host.cdRef.detectChanges();
      }
    });
  }

  subscribeToNextButtonState(host: Host): void {
    this.nextButtonStateService.isButtonEnabled$
      .pipe(takeUntil(host.destroy$))
      .subscribe((enabled: boolean) => {
        host.isNextButtonEnabled = enabled;
        host.cdRef.markForCheck();
      });
  }

  subscribeToTimerExpiry(host: Host): void {
    this.timerService.expired$
      .pipe(takeUntil(host.destroy$))
      .subscribe(() => {
        const idx = host.currentQuestionIndex;
        const selections = host.getSelectionsForQuestion(idx);
        if (selections.length === 0) {
          this.dotStatusService.timerExpiredUnanswered.add(idx);
          host.cdRef.markForCheck();
        }
      });
  }

  setupQuiz(host: Host): void {
    this.resolveQuizData(host);
    this.initializeQuizFromRoute(host);
    this.initializeQuestionStreams(host);
    this.loadQuizQuestionsForCurrentQuiz(host);
    this.createQuestionData(host);
    void this.getQuestion(host);
    void this.handleNavigationToQuestion(host, host.currentQuestionIndex);
  }

  initializeExplanationText(host: Host): void {
    this.explanationTextService.explanationText$
      .pipe(takeUntil(host.destroy$))
      .subscribe((text: string | null) => {
        host.explanationToDisplay = text || '';
        host.cdRef.markForCheck();
      });
  }

  async handleNavigationToQuestion(host: Host, questionIndex: number): Promise<void> {
    this.quizService.getCurrentQuestion(questionIndex).subscribe({
      next: (question: QuizQuestion | null) => {
        if (question?.type != null) this.quizDataService.setQuestionType(question);
        this.quizContentLoaderService.restoreSelectionState(host.currentQuestionIndex);
        this.nextButtonStateService.evaluateNextButtonState(
          host.isAnswered,
          this.quizStateService.isLoadingSig(),
          this.quizStateService.isNavigatingSig()
        );
      },
      error: (error: Error) => console.error('Error fetching question:', error)
    });
  }


  fetchRouteParams(host: Host): void {
    host.activatedRoute.params
      .pipe(takeUntil(host.destroy$))
      .subscribe((params: Params) => {
        host.quizId = params['quizId'];
        host.questionIndex = +params['questionIndex'];
        host.currentQuestionIndex = host.questionIndex - 1;
        void this.loadQuizData(host);
      });
  }

  async loadQuizData(host: Host): Promise<boolean> {
    if (host.isQuizLoaded) return true;
    if (!host.quizId) return false;

    try {
      const result = await this.quizContentLoaderService.loadQuizDataFromService(host.quizId);
      if (!result) return false;

      host.quiz = result.quiz;
      this.applyQuestionsFromSession(host, result.questions);

      const safeIndex = Math.min(Math.max(host.currentQuestionIndex ?? 0, 0), host.questions.length - 1);
      host.currentQuestionIndex = safeIndex;
      host.currentQuestion = host.questions[safeIndex] ?? null;

      this.quizService.setCurrentQuiz(host.quiz);
      host.isQuizLoaded = true;
      return true;
    } catch (error: any) {
      console.error('Error loading quiz data:', error);
      host.questions = [];
      return false;
    }
  }

  subscribeRouterAndInit(host: Host): void {
    host.routerSubscription = host.activatedRoute.data
      .pipe(takeUntil(host.destroy$))
      .subscribe((data: any) => {
        const quizData: Quiz = data['quizData'];
        if (!quizData?.questions?.length) {
          void this.router.navigate(['/select']);
          return;
        }
        host.quizId = quizData.quizId;
        host.questionIndex = +host.activatedRoute.snapshot.params['questionIndex'];
      });
  }

  subscribeToRouteParams(host: Host): void {
    host.activatedRoute.paramMap
      .pipe(
        distinctUntilChanged(
          (prev: ParamMap, curr: ParamMap) =>
            prev.get('questionIndex') === curr.get('questionIndex') &&
            prev.get('quizId') === curr.get('quizId')
        )
      )
      .subscribe((params: ParamMap) => void this.handleParamMapChange(host, params));
  }

  private async handleParamMapChange(host: Host, params: ParamMap): Promise<void> {
    const quizId = params.get('quizId') ?? '';
    const indexParam = params.get('questionIndex');
    const index = Number(indexParam) - 1;
    console.log(`[handleParamMapChange] quizId=${quizId}, indexParam=${indexParam}, index=${index}`);
    if (!quizId || isNaN(index) || index < 0) {
      console.warn(`[handleParamMapChange] EARLY RETURN: quizId=${quizId}, index=${index}`);
      return;
    }

    if (host.quizId && host.quizId !== quizId) {
      this.dotStatusService.clearAllMaps();
      host.clearClickConfirmedDotStatus();
      host.progress = 0;
      this.quizStateService.reset();
    }

    host.quizId = quizId;
    host.currentQuestionIndex = index;
    this.quizService.setQuizId(quizId);
    this.quizService.setCurrentQuestionIndex(index);
    this.timerService.stopTimer?.(undefined, { force: true });
    this.timerService.resetTimer();
    this.timerService.resetTimerFlagsFor(index);

    try {
      const result = await this.quizContentLoaderService.loadQuestionFromRouteChange({ quizId, index });
      console.log(`[handleParamMapChange] loadResult: success=${result.success}, question=${!!result.question}, options=${result.options?.length}`);
      if (!result.success || !result.question) return;

      host.totalQuestions = result.totalQuestions;
      host.currentQuestion = result.question;
      host.question = result.question;
      const payload = {
        question: result.question, options: result.options, explanation: result.explanation,
      };
      console.log(`[handleParamMapChange] EMITTING to combinedQuestionDataSubject: questionText="${result.question.questionText?.substring(0, 50)}", options=${result.options?.length}`);
      host.combinedQuestionDataSubject.next(payload);
      host.questionToDisplaySource.next(result.question.questionText?.trim() ?? '');
      host.optionsToDisplay = [...result.options];
      host.optionsToDisplay$.next([...result.options]);
      host.explanationToDisplay = result.explanation;
      host.qaToDisplay = { question: result.question, options: result.options };
      host.shouldRenderOptions = true;
      host.cdRef.detectChanges();

      // Force question text (with multi-answer banner) into <h3 #qText>
      const displayHTML = this.buildQuestionDisplayHTML(result.question);
      if (displayHTML) {
        const writeH3 = () => {
          try {
            const h3 = document.querySelector('codelab-quiz-content h3');
            if (h3 && !h3.innerHTML.trim()) {
              h3.innerHTML = displayHTML;
            }
          } catch {}
        };
        setTimeout(writeH3, 0);
        setTimeout(writeH3, 100);
        setTimeout(writeH3, 300);
      }

      if (!result.hasValidSelections) this.timerService.restartForQuestion(index);
      localStorage.setItem('savedQuestionIndex', index.toString());
    } catch (error) {
      console.error('[handleParamMapChange]', error);
    }
  }

  resolveQuizData(host: Host): void {
    host.activatedRoute.data
      .pipe(takeUntil(host.unsubscribe$))
      .subscribe(async (data: any) => {
        const quizData = data['quizData'];
        if (!quizData?.questions?.length) {
          void this.router.navigate(['/select']);
          return;
        }
        host.selectedQuiz = quizData;
        this.quizContentLoaderService.initializeFetForQuizData(quizData);
        await this.initializeQuiz(host);
        this.quizContentLoaderService.initializeFetForShuffledQuiz();
      });
  }

  private async initializeQuiz(host: Host): Promise<void> {
    if (host.quizAlreadyInitialized) return;
    host.quizAlreadyInitialized = true;

    await this.prepareQuizSession(host);
    if (host.questionIndex >= 0) {
      this.quizContentLoaderService.fetchAndSubscribeQuestionAndOptions(host.quizId, host.questionIndex);
    }
    this.quizService.setCurrentQuestionIndex(0);

    const firstQuestion = await firstValueFrom(this.quizService.getQuestionByIndex(0));
    if (firstQuestion) {
      this.quizService.setCurrentQuestion(firstQuestion);
      this.quizQuestionDataService.forceRegenerateExplanation(firstQuestion, 0);
    }
  }

  applyQuestionsFromSession(host: Host, questions: QuizQuestion[]): void {
    const result = this.quizContentLoaderService.hydrateQuestionsFromSession({
      questions, quiz: host.quiz, selectedQuiz: host.selectedQuiz,
    });

    host.questions = result.hydratedQuestions;

    if (result.quizQuestions && host.quiz) {
      host.quiz = { ...host.quiz, questions: result.quizQuestions };
    }
    if (result.selectedQuizQuestions && host.selectedQuiz) {
      host.selectedQuiz = { ...host.selectedQuiz, questions: result.selectedQuizQuestions };
    }

    this.syncQuestionSnapshotFromSession(host, result.hydratedQuestions);
  }

  private syncQuestionSnapshotFromSession(host: Host, hydratedQuestions: QuizQuestion[]): void {
    const result = this.quizContentLoaderService.syncQuestionSnapshot({
      hydratedQuestions, currentQuestionIndex: host.currentQuestionIndex,
      previousIndex: host.previousIndex, serviceCurrentIndex: this.quizService?.currentQuestionIndex,
    });
    if (result.isEmpty) {
      host.questionToDisplaySource.next('');
      host.qaToDisplay = undefined;
      host.currentQuestion = null;
      host.optionsToDisplay = [];
      host.optionsToDisplay$.next([]);
      host.hasOptionsLoaded = false;
      host.shouldRenderOptions = false;
      host.explanationToDisplay = '';
      this.explanationTextService.setExplanationText('', { index: host.currentQuestionIndex ?? 0 });
      return;
    }
    host.currentQuestionIndex = result.normalizedIndex;
    host.question = result.question;
    host.currentQuestion = result.question;
    host.qaToDisplay = { question: result.question!, options: result.normalizedOptions };
    host.questionToDisplaySource.next(result.trimmedQuestionText);
    host.optionsToDisplay = [...result.normalizedOptions];
    host.optionsToDisplay$.next([...result.normalizedOptions]);
    host.hasOptionsLoaded = result.normalizedOptions.length > 0;
    host.shouldRenderOptions = host.hasOptionsLoaded;
    host.explanationToDisplay = result.trimmedExplanation;
    if (host.quizQuestionComponent) host.quizQuestionComponent.optionsToDisplay.set([...result.normalizedOptions]);
  }

  private async prepareQuizSession(host: Host): Promise<void> {
    host.currentQuestionIndex = 0;
    host.quizId = host.activatedRoute.snapshot.paramMap.get('quizId') ?? '';
    await this.quizContentLoaderService.prepareQuizSession({
      quizId: host.quizId,
      applyQuestionsFromSession: (questions: QuizQuestion[]) => this.applyQuestionsFromSession(host, questions),
    });
  }

  setupNavigation(host: Host): void {
    host.activatedRoute.params
      .pipe(
        takeUntil(host.destroy$),
        map((params: Params) => +params['questionIndex']),
        distinctUntilChanged(),
        tap((currentIndex: number) => {
          host.isNavigatedByUrl = true;
          void this.updateContentBasedOnIndex(host, currentIndex);
        })
      )
      .subscribe();
  }

  async updateContentBasedOnIndex(host: Host, index: number): Promise<void> {
    const adjustedIndex = index - 1;
    const total = host.quiz?.questions?.length ?? 0;
    if (adjustedIndex < 0 || adjustedIndex >= total) return;

    this.quizContentLoaderService.lockAndPurgeFet(adjustedIndex);

    if (host.previousIndex === adjustedIndex && !host.isNavigatedByUrl) return;

    host.currentQuestionIndex = adjustedIndex;
    host.previousIndex = adjustedIndex;
    this.quizService.currentQuestionIndexSource.next(adjustedIndex);

    host.explanationToDisplay = '';
    this.quizContentLoaderService.resetDisplayExplanationText(host.currentQuestionIndex);
    this.quizContentLoaderService.clearAllOptionStates();
    this.nextButtonStateService.setNextButtonState(false);

    await new Promise<void>((res) => requestAnimationFrame(() => res()));

    try {
      await this.loadQuestionByRouteIndex(host, index);
      this.quizContentLoaderService.unlockFetGateAfterRender(
        adjustedIndex,
        () => host.currentQuestionIndex,
        () => host.cdRef.detectChanges()
      );
      setTimeout(() => this.quizContentLoaderService.enableAllOptionPointerEvents(), 200);
    } catch (error: any) {
      console.error('[updateContentBasedOnIndex]', error);
    } finally {
      host.isNavigatedByUrl = false;
    }
  }

  async loadQuestionByRouteIndex(host: Host, routeIndex: number): Promise<void> {
    try {
      const result = await this.quizContentLoaderService.loadQuestionByRoute({
        routeIndex, quiz: host.quiz, quizId: host.quizId, totalQuestions: host.totalQuestions,
      });
      if (result.questionIndex === -1) { void this.router.navigate(['/question/', host.quizId, 1]); return; }
      if (!result.success || !result.question) return;
      host.currentQuestionIndex = result.questionIndex;
      this.timerService.resetTimer();
      this.timerService.startTimer(this.timerService.timePerQuestion, this.timerService.isCountdown, true);
      this.resetFeedbackState(host);
      host.currentQuestion = result.question;
      host.combinedQuestionDataSubject.next({
        question: result.question, options: result.question.options ?? [], explanation: result.question.explanation ?? ''
      });
      host.questionToDisplaySource.next(result.questionText);
      host.optionsToDisplay = result.optionsWithIds;
      setTimeout(() => {
        this.quizContentLoaderService.restoreSelectedOptionsFromSession(host.optionsToDisplay);
        setTimeout(() => {
          const prev = host.optionsToDisplay.find((opt: Option) => opt.selected);
          if (prev) this.selectedOptionService.reapplySelectionForQuestion(prev, host.currentQuestionIndex);
        }, 50);
      }, 50);
    } catch { host.cdRef.markForCheck(); }
  }

  private resetFeedbackState(host: Host): void {
    for (const option of host.optionsToDisplay) {
      option.feedback = '';
      option.showIcon = false;
      option.selected = false;
    }
    host.cdRef.detectChanges();
  }

  refreshQuestionOnReset(host: Host): void {
    firstValueFrom(this.quizService.getQuestionByIndex(0))
      .then((question: QuizQuestion | null) => {
        if (!question) return;
        this.quizService.setCurrentQuestion(question);
        this.loadCurrentQuestion(host);
      })
      .catch((error: Error) => console.error('[refreshQuestionOnReset]', error));
  }

  initializeQuizFromRoute(host: Host): void {
    host.activatedRoute.data
      .pipe(
        takeUntil(host.destroy$),
        switchMap((data: { quizData?: Quiz }) => {
          if (!data.quizData) {
            void this.router.navigate(['/select']);
            return EMPTY;
          }
          host.quiz = data.quizData;
          this.quizContentLoaderService.resetFetStateForInit();
          return of(true);
        })
      )
      .subscribe(() => {
        this.setupNavigation(host);
        const trimmed = (this.quizService.questions?.[0]?.questionText ?? '').trim();
        if (trimmed) host.questionToDisplaySource.next(trimmed);
        this.quizContentLoaderService.seedFirstQuestionText();
        host.cdRef.markForCheck();
      });
  }

  initializeQuestionStreams(host: Host): void {
    host.questions$ = this.quizDataService.getQuestionsForQuiz(host.quizId);
    host.questions$.subscribe((questions: QuizQuestion[]) => {
      if (!questions?.length) return;
      host.currentQuestionIndex = 0;
      for (const [index] of questions.entries()) {
        this.quizStateService.setQuestionState(
          host.quizId, index, this.quizStateService.createDefaultQuestionState()
        );
      }
      host.currentQuestion = questions[0];
    });
  }

  loadQuizQuestionsForCurrentQuiz(host: Host): void {
    host.isQuizDataLoaded = false;
    this.quizDataService.getQuestionsForQuiz(host.quizId).subscribe({
      next: (questions: QuizQuestion[]) => {
        this.applyQuestionsFromSession(host, questions);
        host.isQuizDataLoaded = true;
      },
      error: () => { host.isQuizDataLoaded = true; }
    });
  }

  createQuestionData(host: Host): void {
    const sub = this.quizContentLoaderService.createNormalizedQuestionPayload$()
      .subscribe((payload: QuestionPayload) => {
        host.combinedQuestionDataSubject.next(payload);
        host.qaToDisplay = { question: payload.question, options: payload.options };
        host.questionToDisplaySource.next(payload.question?.questionText?.trim() ?? 'No question available');
        host.explanationToDisplay = payload.explanation ?? '';
        host.question = payload.question;
        host.currentQuestion = payload.question;
        host.optionsToDisplay = [...payload.options];
        host.optionsToDisplay$.next([...payload.options]);
        host.cdRef.detectChanges();
      });
    host.subscriptions.add(sub);
  }

  async getQuestion(host: Host): Promise<void | null> {
    const quizId = host.activatedRoute.snapshot.params['quizId'];
    const question = await this.quizContentLoaderService.fetchQuestionFromAPI(
      quizId, host.currentQuestionIndex
    );
    host.question = question ?? null;
    if (!question) console.error('Invalid question provided.');
  }

  async updateQuestionStateAndExplanation(host: Host, questionIndex: number): Promise<void> {
    const result = await this.quizContentLoaderService.evaluateQuestionStateAndExplanation({
      quizId: host.quizId, questionIndex,
    });
    if (!result.handled) return;
    host.explanationToDisplay = result.explanationText;
    if (result.showExplanation) host.cdRef.detectChanges();
  }

  selectedAnswer(host: Host, optionIndex: number): void {
    host.markQuestionAnswered(host.currentQuestionIndex);

    const result = this.quizContentLoaderService.processSelectedAnswer({
      optionIndex,
      question: host.question,
      optionsToDisplay: host.optionsToDisplay,
      currentQuestionIndex: host.currentQuestionIndex,
      answers: host.answers,
      selectedOption$: host.selectedOption$,
    });

    if (!result.option) return;
    host.answers = result.answers;
    void this.updateQuestionStateAndExplanation(host, host.currentQuestionIndex);
  }

  loadCurrentQuestion(host: Host): void {
    this.quizService.getQuestionByIndex(host.currentQuestionIndex)
      .pipe(
        tap((question: QuizQuestion | null) => {
          if (!question) {
            console.error('Failed to load question at index:', host.currentQuestionIndex);
            return;
          }
          host.question = question;
          this.quizService.getOptions(host.currentQuestionIndex).subscribe({
            next: (options: Option[]) => {
              host.optionsToDisplay = options || [];
              if (!this.selectedOptionService.isQuestionAnswered(host.currentQuestionIndex)) {
                this.timerService.restartForQuestion(host.currentQuestionIndex);
              }
            },
            error: (error: Error) => {
              console.error('Error fetching options:', error);
              host.optionsToDisplay = [];
            }
          });
        }),
        catchError((error: Error) => {
          console.error('Error fetching question:', error);
          return of(null);
        }),
      )
      .subscribe();
  }

  showExplanationForQuestion(host: Host, qIdx: number): void {
    const { explanationHtml } = this.quizContentLoaderService.prepareExplanationForQuestion({
      qIdx, questionsArray: host.questionsArray, quiz: host.quiz,
      currentQuestionIndex: host.currentQuestionIndex, currentQuestion: host.currentQuestion,
    });
    host.explanationToDisplay = explanationHtml;
    host.cdRef.detectChanges();
  }

  onExplanationChanged(host: Host, explanation: string | any, index?: number): void {
    const resolved = this.quizContentLoaderService.resolveExplanationChange(
      explanation, index, host.explanationToDisplay
    );
    if (!resolved) return;

    const qIdx = resolved.index ?? this.quizService.getCurrentQuestionIndex?.() ?? 0;

    // CORRECTNESS GATE: check if the question is scored correct BEFORE
    // setting any explanation text. Without this, host.explanationToDisplay
    // and setExplanationText fire for every click (including incorrect),
    // triggering FET display through subscription chains.
    // SHUFFLED FIX: use display-order question source.
    const _isShufEC = (this.quizService as any)?.isShuffleEnabled?.()
      && (this.quizService as any)?.shuffledQuestions?.length > 0;
    const rawQ: any = _isShufEC
      ? ((this.quizService as any)?.getQuestionsInDisplayOrder?.()?.[qIdx]
        ?? (this.quizService as any)?.shuffledQuestions?.[qIdx]
        ?? (this.quizService as any)?.questions?.[qIdx])
      : (this.quizService as any)?.questions?.[qIdx];

    const normEC = (t: any) => String(t ?? '').trim().toLowerCase();
    const qTextEC = normEC(rawQ?.questionText);
    let correctCountEC = 0;
    let correctTextsEC: string[] = [];
    try {
      const bundleEC: any[] = (this.quizService as any)?.quizInitialState ?? [];
      if (qTextEC && bundleEC.length > 0) {
        for (const quiz of bundleEC) {
          let found = false;
          for (const pq of (quiz?.questions ?? [])) {
            if (normEC(pq?.questionText) !== qTextEC) continue;
            found = true;
            const pOpts = (pq?.options ?? []).filter(
              (o: any) => o?.correct === true || String(o?.correct) === 'true'
            );
            correctCountEC = pOpts.length;
            correctTextsEC = pOpts.map((o: any) => normEC(o?.text)).filter((t: string) => !!t);
            break;
          }
          if (found) break;
        }
      }
    } catch { /* ignore */ }
    if (correctCountEC === 0) {
      const rawOpts: any[] = rawQ?.options ?? [];
      correctCountEC = rawOpts.filter(
        (o: any) => o?.correct === true || String(o?.correct) === 'true'
      ).length;
      correctTextsEC = rawOpts
        .filter((o: any) => o?.correct === true || String(o?.correct) === 'true')
        .map((o: any) => normEC(o?.text))
        .filter((t: string) => !!t);
    }
    const isMultiAnswer = correctCountEC > 1;

    // For single-answer: block the ENTIRE method if not scored correct.
    // This prevents host.explanationToDisplay and setExplanationText from
    // being called, which avoids triggering subscription chains.
    if (!isMultiAnswer) {
      let scoredCorrect = false;
      try {
        const scoringSvc = (this.quizService as any)?.scoringService;
        // Resolve original index for shuffled mode
        const isShuf = (this.quizService as any)?.isShuffleEnabled?.() && (this.quizService as any)?.shuffledQuestions?.length > 0;
        if (isShuf && scoringSvc?.questionCorrectness) {
          let effectiveQuizId = (this.quizService as any)?.quizId || '';
          if (!effectiveQuizId) {
            try { effectiveQuizId = localStorage.getItem('lastQuizId') || ''; } catch {}
          }
          if (effectiveQuizId) {
            const origIdx = scoringSvc.quizShuffleService?.toOriginalIndex?.(effectiveQuizId, qIdx);
            if (typeof origIdx === 'number' && origIdx >= 0) {
              scoredCorrect = scoringSvc.questionCorrectness.get(origIdx) === true;
            }
          }
        } else {
          scoredCorrect = scoringSvc?.questionCorrectness?.get(qIdx) === true;
        }
        // Also check fetBypass for SOC-driven FET (keyed by display index)
        if (!scoredCorrect) {
          scoredCorrect = this.explanationTextService.fetBypassForQuestion?.get(qIdx) === true;
        }
      } catch { /* ignore */ }
      if (!scoredCorrect) {
        return; // Block entirely — don't set explanationToDisplay or call services
      }
    }

    // For multi-answer: check if all correct selected before proceeding
    if (isMultiAnswer) {
      const selections = this.selectedOptionService.getSelectedOptionsForQuestion(qIdx) ?? [];
      const selTexts = new Set(
        selections
          .filter((s: any) => s?.selected !== false)
          .map((s: any) => normEC(s?.text))
          .filter((t: string) => !!t)
      );
      const allCorrectSelected = correctTextsEC.length > 0
        && correctTextsEC.every((t: string) => selTexts.has(t));
      if (!allCorrectSelected) {
        // Also check scoring override
        let scoredCorrect = false;
        try {
          const scoringSvc = (this.quizService as any)?.scoringService;
          // Resolve original index for shuffled mode
          const isShuf = (this.quizService as any)?.isShuffleEnabled?.() && (this.quizService as any)?.shuffledQuestions?.length > 0;
          if (isShuf && scoringSvc?.questionCorrectness) {
            let effectiveQuizId = (this.quizService as any)?.quizId || '';
            if (!effectiveQuizId) {
              try { effectiveQuizId = localStorage.getItem('lastQuizId') || ''; } catch {}
            }
            if (effectiveQuizId) {
              const origIdx = scoringSvc.quizShuffleService?.toOriginalIndex?.(effectiveQuizId, qIdx);
              if (typeof origIdx === 'number' && origIdx >= 0) {
                scoredCorrect = scoringSvc.questionCorrectness.get(origIdx) === true;
              }
            }
          } else {
            scoredCorrect = scoringSvc?.questionCorrectness?.get(qIdx) === true;
          }
          if (!scoredCorrect) {
            scoredCorrect = this.explanationTextService.fetBypassForQuestion?.get(qIdx) === true;
          }
        } catch { /* ignore */ }
        if (!scoredCorrect) {
          return; // Block entirely for multi-answer too
        }
      }
    }

    // Only set explanation text after correctness check passes
    host.explanationToDisplay = resolved.text;
    this.explanationTextService.setExplanationText(resolved.text, { index: resolved.index });
    this.explanationTextService.setShouldDisplayExplanation(true);
  }

  // ─── Lifecycle / event wrappers extracted from QuizComponent ───

  async runOnInit(host: Host): Promise<void> {
    host.questions$ = this.quizService.questions$;
    this.subscribeToRouteEvents(host);

    const quizId = await host.initializeQuizId();
    if (!quizId) return;
    host.quizId = quizId;

    // Persist quizId so route-event handler doesn't mistake a refresh for a quiz switch
    try { localStorage.setItem('lastQuizId', quizId); } catch {}

    host.initializeQuestionIndex();

    // Check if returning from Results via "Select Quiz" button
    let freshFromResults = false;
    try {
      freshFromResults = sessionStorage.getItem('freshStartFromResults') === 'true';
      sessionStorage.removeItem('freshStartFromResults');
    } catch {}

    if (freshFromResults) {
      this.quizResetService.performRestartServiceResets(host.quizId, host.totalQuestions || 20);
      this.dotStatusService.clearAllMaps();
      this.quizPersistence.clearClickConfirmedDotStatus(host.totalQuestions || 20);
      this.quizPersistence.clearAllPersistedDotStatus(host.quizId);
      this.selectedOptionService.lastClickedCorrectByQuestion.clear();
      this.selectedOptionService.clearRefreshBackup();
      this.selectedOptionService.clearState();
      host.answeredQuestionIndices.clear();
      host.progress = 0;
      // Clear quiz_selection_* so restoreSelectionState doesn't find stale data
      try {
        for (let i = 0; i < 100; i++) {
          sessionStorage.removeItem('quiz_selection_' + i);
          sessionStorage.removeItem('displayMode_' + i);
          sessionStorage.removeItem('feedbackText_' + i);
        }
        sessionStorage.removeItem('selectedOptionsMap');
        sessionStorage.removeItem('rawSelectionsMap');
        sessionStorage.removeItem('answeredQuestionIndices');
      } catch {}
    }

    const cleared = this.quizResetService.clearStaleProgressAndDotStateForFreshStart(
      host.currentQuestionIndex, host.quizId, host.totalQuestions
    );
    if (cleared) host.progress = 0;

    this.fetchTotalQuestions(host);
    this.subscribeToQuestionIndex(host);
    this.bridgeQuestionPayload(host);

    await this.loadQuestions(host);
    host.isQuizLoaded = true;

    // Restore answeredQuestionIndices from clickConfirmedDotStatus (survives F5 refresh)
    for (const [idx, status] of this.selectedOptionService.clickConfirmedDotStatus) {
      if (status === 'correct' || status === 'wrong') {
        host.answeredQuestionIndices.add(idx);
      }
    }
    if (host.answeredQuestionIndices.size > 0) {
      host.progress = Math.round((host.answeredQuestionIndices.size / host.totalQuestions) * 100);
    }

    const initialIndex = host.currentQuestionIndex || 0;
    this.quizService.setCurrentQuestionIndex(initialIndex);
    host.updateDotStatus(initialIndex);

    // Ensure the timer starts on initial quiz load
    if (!this.selectedOptionService.isQuestionAnswered(initialIndex)) {
      this.timerService.restartForQuestion(initialIndex);
      // Safety: re-arm after the rest of the init chain settles, in case
      // a downstream stopTimer() runs and tears the freshly-started timer down.
      setTimeout(() => {
        if (!this.selectedOptionService.isQuestionAnswered(initialIndex)) {
          this.timerService.restartForQuestion(initialIndex);
        }
      }, 300);
    }
    Promise.resolve().then(() => host.cdRef.detectChanges());

    host.quizScoringService.initializeCorrectExpectedCounts(host.questionsArray);
    this.subscribeToNextButtonState(host);
    this.subscribeToTimerExpiry(host);

    this.setupQuiz(host);
    this.fetchRouteParams(host);
    this.subscribeRouterAndInit(host);
    this.subscribeToRouteParams(host);

    host.quizInitializationService.initializeAnswerSync(
      (enabled: boolean) => (host.isNextButtonEnabled = enabled),
      (answered: boolean) => (host.isCurrentQuestionAnswered = answered),
      (_message: string) => {},
      host.destroy$
    );

    host.resetQuestionState();
    this.initializeExplanationText(host);

    // Re-enable next button AFTER resetQuestionState (which disables it).
    // Use clickConfirmedDotStatus as the source of truth — it reliably
    // survives refresh via individual sessionStorage keys, unlike
    // selectedOptionsMap which may be cleared by downstream reset paths.
    const confirmedStatus = this.selectedOptionService.clickConfirmedDotStatus.get(host.currentQuestionIndex);
    const isAnsweredOnRefresh = confirmedStatus === 'correct' || confirmedStatus === 'wrong';
    if (isAnsweredOnRefresh) {
      // Must update BOTH next-button state systems:
      // 1. NextButtonStateService.isButtonEnabled (signal) via forceEnable
      // 2. SelectedOptionService.isNextButtonEnabledSubject via setNextButtonEnabled
      // Use setTimeout to ensure this runs after all init microtasks settle.
      setTimeout(() => {
        this.selectedOptionService.setAnswered(true, true);
        this.selectedOptionService.setNextButtonEnabled(true);
        this.nextButtonStateService.forceEnable(60000);
        host.isNextButtonEnabled = true;
        host.isAnswered = true;
        host.cdRef.detectChanges();
      }, 100);
    }

    // Safety net: after all init subscriptions settle, force progress to 0
    // when restarting from Results. Downstream code (restoreSelectionState,
    // selectedOption$ subscription) can re-mark Q1 as answered from stale
    // sessionStorage entries (quiz_selection_*).
    if (freshFromResults) {
      setTimeout(() => {
        host.answeredQuestionIndices.clear();
        host.progress = 0;
        host.cdRef.detectChanges();
      }, 150);
    }
  }

  runOnDestroy(host: Host): void {
    try { host.unsubscribe$?.next(); } catch {}
    try { host.unsubscribe$?.complete(); } catch {}
    try { host.destroy$?.next(); } catch {}
    try { host.destroy$?.complete(); } catch {}
    try { host.subscriptions?.unsubscribe(); } catch {}
    try { this.dotStatusService.dotStatusCache.clear(); } catch {}
    try { this.dotStatusService.pendingDotStatusOverrides.clear(); } catch {}
    try { this.dotStatusService.activeDotClickStatus.clear(); } catch {}
    host.routeSubscription?.unsubscribe();
    host.routerSubscription?.unsubscribe();
    host.indexSubscription?.unsubscribe();
    host.questionAndOptionsSubscription?.unsubscribe();
    host.optionSelectedSubscription?.unsubscribe();
    try { this.timerService.stopTimer(undefined, { force: true }); } catch {}
    try { this.nextButtonStateService.cleanupNextButtonStateStream(); } catch {}
    if (host.nextButtonTooltip) {
      try {
        host.nextButtonTooltip.disabled = true;
        host.nextButtonTooltip.hide();
      } catch {}
    }
  }

  async runAfterViewInit(host: Host): Promise<void> {
    setTimeout(() => host.checkScrollIndicator(), 500);
    void host.quizQuestionLoaderService.loadQuestionContents(host.currentQuestionIndex);

    if (host.quizQuestionLoaderService.pendingOptions?.length) {
      const opts = host.quizQuestionLoaderService.pendingOptions;
      host.quizQuestionLoaderService.pendingOptions = null;
      Promise.resolve().then(() => {
        if (host.quizQuestionComponent && opts?.length) {
          host.quizQuestionComponent.optionsToDisplay.set([...opts]);
        }
      });
    }

    setTimeout(() => {
      host.quizQuestionComponent?.renderReady$
        ?.pipe(debounceTime(10))
        .subscribe((isReady: boolean) => {
          host.isQuizRenderReady$.next(isReady);
          if (isReady) host.renderStateService.setupRenderGateSync();
        });
    }, 0);
  }

  async runOnGlobalKey(host: Host, event: KeyboardEvent): Promise<void> {
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    // Arrow-key navigation is only allowed once the user has selected an
    // option for the CURRENT question. Without a selection, arrow keys
    // are inert — this prevents skipping a question without answering.
    const currentIdx = this.quizService.getCurrentQuestionIndex();
    const hasSelectionForCurrent =
      (this.selectedOptionService.getSelectedOptionsForQuestion?.(currentIdx) ?? []).length > 0;

    switch (event.key) {
      case 'ArrowRight':
      case 'Enter': {
        if (!hasSelectionForCurrent) return;
        if (host.shouldShowNextButton) {
          event.preventDefault();
          await host.advanceToNextQuestion();
          return;
        }
        if (host.shouldShowResultsButton) {
          event.preventDefault();
          host.advanceToResults();
          return;
        }
        break;
      }
      case 'ArrowLeft': {
        if (!hasSelectionForCurrent) return;
        if (currentIdx > 0) {
          event.preventDefault();
          await host.advanceToPreviousQuestion();
        }
        break;
      }
    }
  }
}
