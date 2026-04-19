import { ComponentRef, Injectable } from '@angular/core';
import { firstValueFrom, Subscription } from 'rxjs';
import { debounceTime, filter, take } from 'rxjs/operators';

import { Option } from '../../../models/Option.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';
import { SelectedOption } from '../../../models/SelectedOption.model';
import { QuestionType } from '../../../models/question-type.enum';
import { Utils } from '../../../utils/utils';

type Host = any;

/**
 * Orchestrates QuizQuestionComponent lifecycle/event method bodies.
 * Methods accept the component instance and mutate it via the host
 * reference, mirroring the QuizSetupService pattern used by QuizComponent.
 */
@Injectable({ providedIn: 'root' })
export class QqcComponentOrchestratorService {

  // ═══════════════════════════════════════════════════════════════
  // ngOnInit body
  // ═══════════════════════════════════════════════════════════════
  async runOnInit(host: Host): Promise<void> {
    const qIndex = host.quizService.getCurrentQuestionIndex();
    host.lifecycle.performRefTrace({ questions: host.quizService.questions, qIndex });

    host.idxSub = host.lifecycle.createIndexTimerSubscription({
      currentQuestionIndex$: host.quizService.currentQuestionIndex$,
      elapsedTime$: host.timerService.elapsedTime$,
      timePerQuestion: host.timerService.timePerQuestion,
      normalizeIndex: (idx: number) => host.normalizeIndex(idx),
      resetPerQuestionState: (i0: number) => host.resetPerQuestionState(i0),
      deleteHandledOnExpiry: (i0: number) => host.handledOnExpiry.delete(i0),
      emitPassiveNow: (i0: number) => host.emitPassiveNow(i0),
      prewarmResolveFormatted: (i0: number) => {
        if (!host._formattedByIndex?.has?.(i0)) {
          host.resolveFormatted(i0, { useCache: true, setCache: true }).catch(() => {});
        }
      },
      onTimerExpiredFor: (i0: number) => host.onTimerExpiredFor(i0),
    });

    host.subscriptionWiring.createCurrentQuestionIndexSubscription((index: number) => {
      host.currentQuestionIndex.set(index);
    });

    host.subscriptionWiring.createQuestionPayloadSubscription({
      onPayload: (payload: any) => {
        host.currentQuestion.set(payload.question);
        host.optionsToDisplay.set(payload.options);
        host.explanationToDisplay.set(payload.explanation ?? '');
        host.updateShouldRenderOptions(host.optionsToDisplay());
      },
    });

    host.shufflePreferenceSubscription = host.subscriptionWiring.createShufflePreferenceSubscription(
      (shouldShuffle: boolean) => { host.shuffleOptions = shouldShuffle; }
    );

    const navSubs = host.subscriptionWiring.createNavigationEventSubscriptions({
      onNavigationSuccess: () => host.resetUIForNewQuestion(),
      onNavigatingBack: () => {
        if (host.sharedOptionComponent) {
          host.sharedOptionComponent.isNavigatingBackwards = true;
        }
        host.resetUIForNewQuestion();
      },
      onNavigationToQuestion: ({ question, options }: { question: QuizQuestion; options: Option[] }) => {
        if (!host.containerInitialized && host.dynamicAnswerContainer) {
          host.loadDynamicComponent(question, options);
          host.containerInitialized = true;
        }
        host.sharedOptionConfig = null;
      },
      onExplanationReset: () => host.resetExplanation(),
      onRenderReset: () => { host.renderReady = false; },
      onResetUIForNewQuestion: () => host.resetUIForNewQuestion(),
    });
    navSubs.forEach((sub: Subscription) => host.displaySubscriptions.push(sub));

    host.subscriptionWiring.createPreResetSubscription({
      destroy$: host.destroy$,
      onPreReset: (idx: number) => host.resetPerQuestionState(idx),
      getLastResetFor: () => host.lastResetFor,
      setLastResetFor: (idx: number) => { host.lastResetFor = idx; },
    });

    host.subscriptionWiring.createRouteParamSubscription({
      activatedRoute: host.activatedRoute,
      onRouteChange: async (questionIndex: number) => {
        host.explanationVisible = false;
        host.explanationText.set('');
        try {
          const question = await firstValueFrom(host.quizService.getQuestionByIndex(questionIndex));
          if (!question) return;
        } catch {}
      },
    });

    const initialIdx = host.lifecycle.computeInitialQuestionIndex(host.activatedRoute);
    host.currentQuestionIndex.set(initialIdx.currentQuestionIndex);
    host.fixedQuestionIndex = initialIdx.fixedQuestionIndex;

    const loaded = await host.loadQuestion();
    if (!loaded) return;

    host.subscriptionWiring.createTimerExpiredSubscription({
      destroy$: host.destroy$,
      timerExpired$: host.timerService.expired$,
      onExpired: () => {
        const idx = host.normalizeIndex(host.currentQuestionIndex() ?? 0);
        host.onQuestionTimedOut(idx);
      },
    });

    host.subscriptionWiring.createTimerStopSubscription({
      destroy$: host.destroy$,
      timerStop$: host.timerService.stop$,
      onTimerStopped: () => {
        const reason = host.timedOut ? 'timeout' : 'stopped';
        host.handleTimerStoppedForActiveQuestion(reason);
      },
    });

    try {
      Object.getPrototypeOf(Object.getPrototypeOf(host)).ngOnInit?.call(host);

      host.populateOptionsToDisplay();

      host.displayModeSubscription = host.subscriptionWiring.createDisplayModeSubscription(
        host.currentQuestionIndex(),
        false
      );

      host.renderReady$ = host.lifecycle.createRenderReadyObservable({
        questionPayloadSubject: host.questionPayloadSubject,
        setCurrentQuestion: (q: QuizQuestion | null) => { host.currentQuestion.set(q); },
        setOptionsToDisplay: (opts: Option[]) => { host.optionsToDisplay.set(opts); },
        setExplanationToDisplay: (text: string) => { host.explanationToDisplay.set(text); },
        setRenderReady: (val: boolean) => { host.renderReady = val; },
        emitRenderReady: (val: boolean) => host.renderReadySubject.next(val),
      });
      host.renderReadySubscription = host.renderReady$.subscribe();

      document.addEventListener('visibilitychange', host.onVisibilityChange.bind(host));

      host.questionLoader.initializeComponentState({
        questionsArray: host.questionsArray,
        currentQuestionIndex: host.currentQuestionIndex(),
      }).then((result: any) => {
        if (!result) return;
        host.questionsArray = result.questionsArray;
        host.currentQuestionIndex.set(result.currentQuestionIndex);
        host.currentQuestion.set(result.currentQuestion);
        host.generateFeedbackText(host.currentQuestion()).then(
          (text: string) => { host.feedbackText = text; },
          () => { host.feedbackText = 'Unable to generate feedback.'; }
        );
      });

      host.questionLoader.waitForQuestionData({
        currentQuestionIndex: host.currentQuestionIndex(),
        quizId: host.quizService.quizId,
      }).then((waitResult: any) => {
        if (!waitResult.currentQuestion) return;
        host.currentQuestionIndex.set(waitResult.currentQuestionIndex);
        host.currentQuestion.set(waitResult.currentQuestion);
        host.optionsToDisplay.set(waitResult.optionsToDisplay);
        host.quizService.getCurrentOptions(host.currentQuestionIndex()).pipe(take(1)).subscribe((options: Option[]) => {
          host.optionsToDisplay.set(Array.isArray(options) ? options : []);
          const previouslySelectedOption = host.optionsToDisplay().find((opt: Option) => opt.selected);
          if (previouslySelectedOption) {
            host.applyOptionFeedback(previouslySelectedOption);
          }
        });
        host.initializeForm();
        host.questionForm.updateValueAndValidity();
        window.scrollTo(0, 0);
      });

      if (host.question()) {
        host.data.set(host.questionLoader.buildInitialData(host.question(), host.options()));
      }
      host.initializeForm();
      host.quizStateService.setLoading(true);

      await host.initializeQuiz();
      await host.initializeQuizDataAndRouting();

      const quizQuestionSub = host.initializer.initializeQuizQuestion({
        onQuestionsLoaded: (_questions: QuizQuestion[]) => {},
      });
      if (quizQuestionSub) {
        host.questionsObservableSubscription = quizQuestionSub;
      }

      const questionIndexParam = host.activatedRoute.snapshot.paramMap.get('questionIndex');
      const firstQuestionIndex = host.initializer.parseQuestionIndexFromRoute(questionIndexParam);
      const firstQResult = host.initializer.setQuestionFirst({
        index: firstQuestionIndex,
        questionsArray: host.questionsArray,
      });
      if (firstQResult) {
        host.currentQuestion.set(firstQResult.currentQuestion);
        host.optionsToDisplay.set(firstQResult.optionsToDisplay);
        if (host.lastProcessedQuestionIndex !== firstQResult.questionIndex || firstQResult.questionIndex === 0) {
          host.lastProcessedQuestionIndex = firstQResult.questionIndex;
        }
        setTimeout(() => {
          host.updateExplanationIfAnswered(firstQResult.questionIndex, firstQResult.currentQuestion!);
        }, 50);
      }

      if (host.currentQuestionIndex === 0) {
        const initialMessage = 'Please start the quiz by selecting an option.';
        if (host.selectionMessage() !== initialMessage) {
          host.selectionMessage.set(initialMessage);
        }
      } else {
        host.resetManager.clearSelection(host.correctAnswers, host.currentQuestion());
      }

      host.sharedVisibilitySubscription = host.subscriptionWiring.createVisibilitySubscription({
        onHidden: () => host.handlePageVisibilityChange(true),
        onVisible: () => host.handlePageVisibilityChange(false),
      });

      host.subscriptionWiring.createRouteListener({
        activatedRoute: host.activatedRoute,
        getQuestionsLength: () => host.questions?.length ?? 0,
        onRouteChange: (adjustedIndex: number) => {
          host.quizService.updateCurrentQuestionIndex(adjustedIndex);
          host.fetchAndSetExplanationText(adjustedIndex);
        },
      });

      const resetSubs = host.subscriptionWiring.createResetSubscriptions({
        onResetFeedback: () => host.resetFeedback(),
        onResetState: () => host.resetState(),
      });
      host.resetFeedbackSubscription = resetSubs[0];
      host.resetStateSubscription = resetSubs[1];

      host.subscriptionWiring.createTotalQuestionsSubscription({
        quizId: host.quizId()!,
        destroy$: host.destroy$,
        onTotal: (totalQuestions: number) => { host.totalQuestions = totalQuestions; },
      });
    } catch (error) {
      console.error('Error in ngOnInit:', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ngAfterViewInit body
  // ═══════════════════════════════════════════════════════════════
  async runAfterViewInit(host: Host): Promise<void> {
    const idx = host.fixedQuestionIndex ?? host.currentQuestionIndex() ?? 0;
    host.resetForQuestion(idx);

    host.lifecycle.deferRenderReadySubscription({
      sharedOptionComponent: host.sharedOptionComponent,
      subscribeToRenderReady: () => {
        if (!host.sharedOptionComponent) return;
        host.sharedOptionComponent.renderReady$
          .pipe(filter((ready: boolean) => ready === true), take(1))
          .subscribe(() => host.cdRef.detectChanges());
      },
    });

    host.lifecycle.createOptionsLoaderSubscription({
      options$: host.quizQuestionLoaderService.options$,
      setCurrentOptions: (opts: Option[]) => { host.currentOptions = opts; },
    });

    host.questionLoader.createPayloadHydrationSubscription({
      payloadSubject: host.payloadSubject,
      getHydrationInProgress: () => host.hydrationInProgress,
      setHydrationInProgress: (val: boolean) => { host.hydrationInProgress = val; },
      setRenderReady: (val: boolean) => { host.renderReady = val; },
      setCurrentQuestion: (q: QuizQuestion | null) => { host.currentQuestion.set(q); },
      setExplanationToDisplay: (text: string) => { host.explanationToDisplay.set(text); },
      setOptionsToDisplay: (opts: Option[]) => { host.optionsToDisplay.set(opts); },
      initializeOptionBindings: () => {
        if (host.sharedOptionComponent) {
          host.sharedOptionComponent.initializeOptionBindings();
        }
      },
      releaseBaseline: (i: number) => host.selectionMessageService.releaseBaseline(i),
      getCurrentQuestionIndex: () => host.currentQuestionIndex(),
      detectChanges: () => host.cdRef.detectChanges(),
    });

    const index = host.currentQuestionIndex();

    const setupResult = await host.questionLoader.performAfterViewInitQuestionSetup({
      questionsArray: host.questionsArray,
      currentQuestionIndex: index,
      getFormattedExplanation: (q: QuizQuestion, i: number) => host.explanationManager.getFormattedExplanation(q, i),
      updateExplanationUI: (i: number, text: string) => host.updateExplanationUI(i, text),
    });

    if (!setupResult) {
      setTimeout(() => host.ngAfterViewInit(), 50);
      return;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ngOnChanges body
  // ═══════════════════════════════════════════════════════════════
  async runOnChanges(host: Host, changes: any): Promise<void> {
    const fetClear = host.displayStateManager.shouldClearFetEarlyShown({
      newIndex: changes['currentQuestionIndex']?.currentValue,
      prevIndex: changes['currentQuestionIndex']?.previousValue,
    });
    if (fetClear.shouldClear && host._fetEarlyShown instanceof Set) {
      host._fetEarlyShown.delete(fetClear.indexToClear);
    }

    if (changes['questionPayload'] && host.questionPayload) {
      host.hydrateFromPayload(host.questionPayload);
      host.questionPayloadSubject.next(host.questionPayload);
      setTimeout(() => {
        if (host.displayStateManager.shouldTriggerHydrationFallback({
          renderReady: host.renderReady,
          options: host.optionsToDisplay(),
        })) {
          host.renderReady = true;
          host.cdRef.detectChanges();
        }
      }, 150);
    }

    if (changes['currentQuestionIndex'] && !changes['currentQuestionIndex'].firstChange) {
      host.explanationVisible = false;
      host.explanationText.set('');
    }

    if (changes['question']) {
      host.optionsToDisplay.set(host.resetManager.clearOptionStateForQuestion(host.previousQuestionIndex(), host.optionsToDisplay()));
      host.cdRef.detectChanges();
    }

    if (changes['question'] || changes['options']) {
      host.unselectOption();
      host.handleQuestionAndOptionsChange(changes['question'], changes['options']);
      if (host.currentQuestionIndex() != null) {
        host.restoreSelectionsAndIconsForQuestion(host.quizService.currentQuestionIndex);
      }
      host.previousQuestionIndex.set(host.currentQuestionIndex());
    }

    const isRenderReady = host.displayStateManager.computeRenderReadyFromInputs({
      questionDataText: host.questionData()?.questionText,
      currentQuestionText: host.currentQuestion()?.questionText,
      options: host.options(),
    });

    if (isRenderReady) {
      setTimeout(() => host.renderReadySubject.next(true), 0);
    } else {
      host.renderReadySubject.next(false);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ngOnDestroy body (besides super)
  // ═══════════════════════════════════════════════════════════════
  runOnDestroy(host: Host): void {
    try { document.removeEventListener('visibilitychange', host.onVisibilityChange.bind(host)); } catch {}
    try { host.destroy$?.next(); } catch {}
    try { host.destroy$?.complete(); } catch {}
    host.idxSub?.unsubscribe();
    host.questionsObservableSubscription?.unsubscribe();
    host.sharedVisibilitySubscription?.unsubscribe();
    host.resetFeedbackSubscription?.unsubscribe();
    host.resetStateSubscription?.unsubscribe();
    host.displayModeSubscription?.unsubscribe();
    host.renderReadySubscription?.unsubscribe();
    host.shufflePreferenceSubscription?.unsubscribe();
    try { host.nextButtonStateService.cleanupNextButtonStateStream(); } catch {}
  }

  // ═══════════════════════════════════════════════════════════════
  // onVisibilityChange body
  // ═══════════════════════════════════════════════════════════════
  async runOnVisibilityChange(host: Host): Promise<void> {
    if (document.visibilityState === 'hidden') {
      host.navigationHandler.persistStateOnHide({
        quizId: host.quizId()!,
        currentQuestionIndex: host.currentQuestionIndex() ?? 0,
        displayExplanation: host.displayExplanation,
      });
      host.navigationHandler.resetExplanationStateOnHide();
      await host.navigationHandler.captureElapsedOnHide();
      return;
    }

    try {
      const { shouldExpire, expiredIndex } = await host.navigationHandler.handleFastPathExpiry({
        currentQuestionIndex: host.currentQuestionIndex() ?? 0,
        displayExplanation: host.displayExplanation,
        normalizeIndex: (idx: number) => host.normalizeIndex(idx),
      });
      if (shouldExpire) {
        host.timerService.stopTimer?.(undefined, { force: true });
        host.ngZone.run(() => host.onTimerExpiredFor(expiredIndex));
        return;
      }
    } catch {}

    try {
      if (document.visibilityState !== 'visible') return;
      host._visibilityRestoreInProgress = true;
      (host.explanationTextService as any)._visibilityLocked = true;
      host._suppressDisplayStateUntil = performance.now() + 300;

      const restoreResult = await host.navigationHandler.performFullVisibilityRestore({
        quizId: host.quizId()!,
        currentQuestionIndex: host.currentQuestionIndex() ?? 0,
        optionsToDisplay: host.optionsToDisplay(),
        currentQuestion: host.currentQuestion(),
        generateFeedbackText: (q: QuizQuestion) => host.generateFeedbackText(q),
        applyOptionFeedback: (opt: Option) => host.applyOptionFeedback(opt),
        restoreFeedbackState: () => {
          host.optionsToDisplay.set(host.feedbackManager.restoreFeedbackState(
            host.currentQuestion(),
            host.optionsToDisplay(),
            host.correctMessage()
          ));
        },
      });

      host.displayState.mode = restoreResult.displayMode as 'question' | 'explanation';
      host.optionsToDisplay.set(restoreResult.optionsToDisplay);
      host.feedbackText = restoreResult.feedbackText;
      host.displayExplanation = restoreResult.shouldShowExplanation;
      host.safeSetDisplayState(
        restoreResult.shouldShowExplanation
          ? { mode: 'explanation', answered: true }
          : { mode: 'question', answered: false }
      );

      setTimeout(() => {
        (host.explanationTextService as any)._visibilityLocked = false;
        host._visibilityRestoreInProgress = false;
        setTimeout(
          () => host.navigationHandler.refreshExplanationStatePostRestore(host.currentQuestionIndex() ?? 0),
          400
        );
      }, 350);
    } catch {}
  }

  // ═══════════════════════════════════════════════════════════════
  // onOptionClicked body
  // ═══════════════════════════════════════════════════════════════
  async runOnOptionClicked(
    host: Host,
    event: { option: any; index: number; checked: boolean; wasReselected?: boolean }
  ): Promise<void> {
    host._skipNextAsyncUpdates = false;

    if (host._pendingRAF != null) {
      cancelAnimationFrame(host._pendingRAF);
      host._pendingRAF = null;
    }

    if (!host.quizStateService.isInteractionReady()) {
      await firstValueFrom(host.quizStateService.interactionReady$.pipe(filter(Boolean), take(1)));
    }

    if (!host.currentQuestion() || !host.currentOptions) return;

    const idx = host.quizService.getCurrentQuestionIndex() ?? 0;
    // SHUFFLED FIX: host.questions is original-order, but idx is a DISPLAY
    // index. In shuffled mode questions[idx] gets the WRONG question, which
    // makes isMultiForSelection return false and blocks multi-answer FET.
    // Use getQuestionsInDisplayOrder() to get the actually-displayed question.
    const q = host.quizService.getQuestionsInDisplayOrder?.()?.[idx]
      ?? host.questions?.[idx];
    const evtIdx = event.index;
    const evtOpt = event.option;

    host.explanationDisplay.resetExplanationStateForClick(idx);

    if (evtOpt == null) return;

    try {
      const lockIdNum = Number(evtOpt?.optionId);
      if (Number.isFinite(lockIdNum) && host.selectedOptionService.isOptionLocked(idx, lockIdNum)) {
        return;
      }
    } catch {}

    if (host._clickGate) return;
    host._clickGate = true;
    host.questionFresh = false;

    try {
      const clickResult = host.clickOrchestrator.performSynchronousClickFlow({
        question: q!,
        questionIndex: idx,
        evtIdx,
        evtOpt,
        checked: event.checked,
        optionsToDisplay: host.optionsToDisplay(),
        currentQuestionOptions: host.currentQuestion()?.options,
        totalQuestions: host.totalQuestions,
        msgTok: host._msgTok,
      });

      const { canonicalOpts, selectedKeysSet: selOptsSetImmediate, isMultiForSelection, allCorrect } = clickResult;
      host._msgTok = clickResult.msgTok;
      host._lastAllCorrect = allCorrect;

      // ── DIAGNOSTIC: trace the multi-answer FET decision chain ──
      console.warn(`%c[FET-DIAG] Q${idx + 1} click: q=${q?.questionText?.substring(0, 40)} type=${q?.type} correctCount=${(q?.options ?? []).filter((o: any) => o?.correct === true || String(o?.correct) === 'true').length} isMulti=${isMultiForSelection} allCorrect=${allCorrect} → fetGateEntry=${allCorrect && isMultiForSelection}`, 'background:#060;color:#fff;padding:2px 6px;');

      host.updateOptionHighlighting(selOptsSetImmediate);
      host.refreshFeedbackFor(evtOpt ?? undefined);

      // SINGLE-ANSWER disable function — re-callable from microtask/RAF
      const applySingleAnswerDisable = () => {
      // SINGLE-ANSWER: when the clicked option is correct, mutate bindings so
      // incorrect options become disabled (dark gray) and only the correct one
      // stays active. Use RAW quizService data to determine correctness so
      // mutated/polluted question.options can't break detection.
      try {
        const rawQuestion: any = host.quizService.getQuestionsInDisplayOrder?.()?.[idx]
          ?? (host.quizService as any)?.questions?.[idx]
          ?? q;
        const rawOpts: any[] = rawQuestion?.options ?? [];
        const rawCorrectCount = rawOpts.filter((o: any) =>
          o?.correct === true || String(o?.correct) === 'true'
        ).length;
        const isSingleAnswer = rawCorrectCount <= 1;
        const correctIdSet = new Set<number>(
          rawOpts
            .map((o: any, i: number) => {
              const c = o?.correct === true || String(o?.correct) === 'true';
              if (!c) return -1;
              const id = Number(o?.optionId);
              return Number.isFinite(id) && id !== -1 ? id : i;
            })
            .filter((n: number) => n >= 0)
        );
        const clickedId = Number(evtOpt?.optionId);
        const clickedKey = Number.isFinite(clickedId) && clickedId !== -1 ? clickedId : evtIdx;
        // Trust evtOpt.correct as fallback when raw data is empty/polluted
        const clickedIsCorrect = correctIdSet.has(clickedKey)
          || evtOpt?.correct === true
          || String(evtOpt?.correct) === 'true';

        // If raw set is empty but click is correct, populate it from the click
        if (correctIdSet.size === 0 && clickedIsCorrect) {
          correctIdSet.add(clickedKey);
        }

        if (isSingleAnswer && clickedIsCorrect) {
          const targets: any[][] = [];
          const soc: any = host.sharedOptionComponent;
          if (soc?.optionBindings?.length) targets.push(soc.optionBindings);
          const sigBindings: any[] = host.optionBindings?.() ?? [];
          if (sigBindings?.length) targets.push(sigBindings);
          for (const arr of targets) {
            for (let bi = 0; bi < arr.length; bi++) {
              const b = arr[bi];
              if (!b) continue;
              const bId = Number(b.option?.optionId);
              const effId = Number.isFinite(bId) && bId !== -1 ? bId : bi;
              const isCorrect = correctIdSet.has(effId);
              b.disabled = !isCorrect;
              if (b.option) b.option.active = isCorrect;
              // Keep previously-selected incorrect options highlighted red
              if (!isCorrect && (b.isSelected || b.option?.selected)) {
                b.highlight = true;
                b.showFeedback = true;
                if (b.option) {
                  b.option.highlight = true;
                  b.option.showIcon = true;
                  b.option.feedback = b.option.feedback || 'incorrect';
                }
              }
            }
          }
          soc?.cdRef?.markForCheck?.();
          soc?.cdRef?.detectChanges?.();
        }
      } catch {}
      };

      applySingleAnswerDisable();

      host.cdRef.markForCheck();
      host.cdRef.detectChanges();

      const lockedIndex = host.currentQuestionIndex() ?? idx;

      // Multi-answer FET gate: verify all correct selected using authoritative
      // question data so mutated canonicalOpts correct flags can't fire
      // FET prematurely.
      // SHUFFLED FIX: idx is a DISPLAY index. In shuffled mode,
      // quizService.questions[] is original order, so questions[idx] gets the
      // WRONG question. Use getQuestionsInDisplayOrder() which returns the
      // shuffled array when shuffle is active.
      let fetGatePassed = allCorrect && isMultiForSelection;
      if (fetGatePassed) {
        try {
          const displayQ: any = host.quizService.getQuestionsInDisplayOrder?.()?.[idx]
            ?? (host.quizService as any)?.questions?.[idx]
            ?? q;
          const norm = (t: any) => String(t ?? '').trim().toLowerCase();
          // Get correct option texts from PRISTINE quizInitialState to avoid
          // mutated correct flags from option-lock-policy backfill.
          let rawCorrectTexts = new Set<string>();
          try {
            const qTextNorm = norm(displayQ?.questionText);
            for (const quiz of ((host.quizService as any)?.quizInitialState ?? []) as any[]) {
              for (const pq of (quiz?.questions ?? [])) {
                if (norm(pq?.questionText) !== qTextNorm) continue;
                rawCorrectTexts = new Set(
                  (pq?.options ?? [])
                    .filter((o: any) => o?.correct === true || String(o?.correct) === 'true')
                    .map((o: any) => norm(o?.text))
                    .filter((t: string) => !!t)
                );
                break;
              }
              if (rawCorrectTexts.size > 0) break;
            }
          } catch { /* ignore */ }
          // Fallback to live options if pristine lookup missed
          if (rawCorrectTexts.size === 0) {
            const rawOpts: any[] = displayQ?.options ?? [];
            rawCorrectTexts = new Set(
              rawOpts.filter((o: any) => o?.correct === true || String(o?.correct) === 'true')
                .map((o: any) => norm(o?.text))
                .filter((t: string) => !!t)
            );
          }
          const svcSel = host.selectedOptionService.getSelectedOptionsForQuestion(idx) ?? [];
          const selTexts = new Set(svcSel.map((s: any) => norm(s?.text)).filter((t: string) => !!t));
          const allCorrectSel = rawCorrectTexts.size > 0 && [...rawCorrectTexts].every(t => selTexts.has(t));
          if (!allCorrectSel) {
            console.log(`[QQC-Orch] FET gate blocked Q${idx + 1}: allCorrectSel=${allCorrectSel} correctTexts=${JSON.stringify([...rawCorrectTexts])} selTexts=${JSON.stringify([...selTexts])}`);
            fetGatePassed = false;
          }
        } catch { /* trust upstream */ }
      }

      console.warn(`%c[FET-DIAG] Q${idx + 1} fetGatePassed=${fetGatePassed} earlyShown=${host._fetEarlyShown.has(lockedIndex)} → willTrigger=${fetGatePassed && !host._fetEarlyShown.has(lockedIndex)}`, 'background:#060;color:#fff;padding:2px 6px;');
      if (fetGatePassed && !host._fetEarlyShown.has(lockedIndex)) {
        if (host.timerEffect.safeStopTimer('completed', host._timerStoppedForQuestion, host._lastAllCorrect)) {
          host._timerStoppedForQuestion = true;
        }
        host._fetEarlyShown.add(lockedIndex);
        const displayQForFet = host.quizService.getQuestionsInDisplayOrder?.()?.[lockedIndex] ?? q;
        host.explanationFlow.triggerMultiAnswerFet({ lockedIndex, question: displayQForFet }).then((fetResult: any) => {
          if (host.currentQuestionIndex() !== lockedIndex || !fetResult) return;
          host.displayExplanation = true;
          host.displayStateSubject?.next({ mode: 'explanation', answered: true });
          host.showExplanationChange.emit(true);
          host.explanationToDisplay.set(fetResult.formatted);
          host.explanationToDisplayChange?.emit(fetResult.formatted);
        }).catch(() => {});
      }

      queueMicrotask(() => {
        if (host._skipNextAsyncUpdates) return;
        host.updateOptionHighlighting(selOptsSetImmediate);
        host.refreshFeedbackFor(evtOpt ?? undefined);
        applySingleAnswerDisable();
        host.cdRef.markForCheck();
        host.cdRef.detectChanges();
      });

      requestAnimationFrame(() => {
        if (host._skipNextAsyncUpdates || idx !== host.currentQuestionIndex()) return;
        const resolvedQuizId =
          host.quizService.quizId ||
          host.activatedRoute.snapshot.paramMap.get('quizId') ||
          'dependency-injection';
        host.clickOrchestrator.performPostClickRafTasks({
          idx,
          evtOpt: evtOpt ?? undefined,
          evtIdx,
          question: q!,
          event,
          quizId: resolvedQuizId,
          generateFeedbackText: (question: QuizQuestion) => host.generateFeedbackText(question),
          postClickTasks: (opt: any, i: number, checked: boolean, wasPrev: boolean, qIdx: number) =>
            host.postClickTasks(opt, i, checked, wasPrev, qIdx),
          handleCoreSelection: (ev: any, i: number) => {
            host.performInitialSelectionFlow(ev, ev.option);
            const coreResult = host.optionSelection.handleCoreSelectionState({
              option: ev.option,
              questionIndex: i,
              currentQuestionIndex: host.currentQuestionIndex(),
              questionType: host.question()?.type,
              forceQuestionDisplay: host.forceQuestionDisplay,
              lastAllCorrect: host._lastAllCorrect,
            });
            if (coreResult.isAnswered) host.isAnswered = true;
            host.forceQuestionDisplay = coreResult.forceQuestionDisplay;
            if (coreResult.displayStateAnswered) {
              host.displayState.answered = coreResult.displayStateAnswered;
              host.displayState.mode = coreResult.displayStateMode;
            }
            host.cdRef.detectChanges();
          },
          markBindingSelected: (opt: any) => {
            const b = host.feedbackManager.markBindingSelected(opt, host.currentQuestionIndex(), host.optionBindings());
            if (!b) return;
            host.optionBindings.set(host.optionBindings().map((ob: any) =>
              ob.option.optionId === b.option.optionId ? b : ob
            ));
            b.directiveInstance?.updateHighlight();
          },
          refreshFeedbackFor: (opt: Option) => host.refreshFeedbackFor(opt),
        }).catch(() => {}).finally(() => {
          applySingleAnswerDisable();
          host.cdRef?.markForCheck?.();
          host.cdRef?.detectChanges?.();
        });
      });

      // Final safety net: re-apply after all click pipelines have settled
      setTimeout(() => {
        applySingleAnswerDisable();
        host.sharedOptionComponent?.cdRef?.markForCheck?.();
        host.sharedOptionComponent?.cdRef?.detectChanges?.();
        host.cdRef?.markForCheck?.();
        host.cdRef?.detectChanges?.();
      }, 0);

    } finally {
      queueMicrotask(() => {
        host._clickGate = false;
        host.selectionMessageService.releaseBaseline(host.currentQuestionIndex());
        const selectionComplete =
          q?.type === QuestionType.SingleAnswer ? !!evtOpt?.correct : host._lastAllCorrect;
        host.selectionMessageService.setSelectionMessage(selectionComplete);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // loadDynamicComponent body
  // ═══════════════════════════════════════════════════════════════
  async runLoadDynamicComponent(host: Host, question: QuizQuestion, options: Option[]): Promise<void> {
    try {
      if (
        !question ||
        !Array.isArray(options) ||
        !options.length ||
        !host.dynamicAnswerContainer ||
        !('questionText' in question)
      ) {
        return;
      }
      let isMultipleAnswer = false;
      try {
        isMultipleAnswer = await firstValueFrom(
          host.quizQuestionManagerService.isMultipleAnswerQuestion(question)
        );
      } catch {
        return;
      }

      host.dynamicAnswerContainer.clear();
      await Promise.resolve();
      const componentRef: ComponentRef<any> = await host.dynamicComponentService.loadComponent(
        host.dynamicAnswerContainer,
        isMultipleAnswer,
        host.onOptionClicked.bind(host)
      );
      if (!componentRef?.instance) return;
      const instance = componentRef.instance;

      const configured = host.questionLoader.configureDynamicInstance({
        instance,
        componentRef,
        question,
        options,
        isMultipleAnswer,
        currentQuestionIndex: host.currentQuestionIndex(),
        navigatingBackwards: false,
        defaultConfig: host.getDefaultSharedOptionConfig?.(),
        onOptionClicked: host.onOptionClicked.bind(host),
      });
      host.questionData.set(configured.questionData);
      host.sharedOptionConfig = configured.sharedOptionConfig;
      host.cdRef.markForCheck();
      await (instance as any).initializeSharedOptionConfig(configured.clonedOptions);
      if (!Object.prototype.hasOwnProperty.call(instance, 'onOptionClicked')) {
        instance.onOptionClicked = host.onOptionClicked.bind(host);
      }
      host.updateShouldRenderOptions(instance.optionsToDisplay());
      if (host.displayStateManager.computeRenderReadiness(instance.optionsToDisplay())) {
        host.shouldRenderOptions.set(true);
      }
      try { componentRef.changeDetectorRef.markForCheck(); } catch {}
    } catch (error) {
      console.error('[loadDynamicComponent] Failed:', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // loadQuestion body
  // ═══════════════════════════════════════════════════════════════
  async runLoadQuestion(host: Host, signal?: AbortSignal): Promise<boolean> {
    host.readyForExplanationDisplay = false;
    host.isExplanationReady = false;
    host.isExplanationLocked = true;
    host.forceQuestionDisplay = true;

    const shouldPreserveVisualState = host.questionLoader.canRenderQuestionInstantly(
      host.questionsArray,
      host.currentQuestionIndex()
    );
    const explanationSnapshot = host.explanationManager.captureExplanationSnapshot({
      preserveVisualState: shouldPreserveVisualState,
      index: host.currentQuestionIndex(),
      explanationToDisplay: host.explanationToDisplay(),
      quizId: host.quizId(),
      isAnswered: host.isAnswered as boolean,
      displayMode: host.displayMode$.getValue(),
      shouldDisplayExplanation: host.shouldDisplayExplanation,
      explanationVisible: host.explanationVisible,
      displayExplanation: host.displayExplanation,
      displayStateAnswered: host.displayState?.answered,
    });
    const shouldKeepExplanationVisible = explanationSnapshot.shouldRestore;

    host.questionLoader.performPreLoadReset({
      shouldPreserveVisualState,
      shouldKeepExplanationVisible,
      currentQuestionIndex: host.currentQuestionIndex(),
    });

    if (shouldPreserveVisualState) {
      host.isLoading = false;
    } else {
      host.isLoading = true;
      host.quizStateService.setLoading(true);
      host.quizStateService.setAnswerSelected(false);
      if (!host.quizStateService.isLoading()) host.quizStateService.startLoading();
    }

    try {
      host.selectedOptionId = null;
      const lockedIndex = host.currentQuestionIndex();

      await host.resetQuestionStateBeforeNavigation({
        preserveVisualState: shouldPreserveVisualState,
        preserveExplanation: shouldKeepExplanationVisible,
      });

      if (!shouldKeepExplanationVisible) {
        const clearResult = host.questionLoader.performPostResetExplanationClear();
        host.renderReadySubject.next(false);
        host.displayState = clearResult.displayState;
        host.forceQuestionDisplay = clearResult.forceQuestionDisplay;
        host.readyForExplanationDisplay = clearResult.readyForExplanationDisplay;
        host.isExplanationReady = clearResult.isExplanationReady;
        host.isExplanationLocked = clearResult.isExplanationLocked;
        host.feedbackText = clearResult.feedbackText;
      } else {
        const restoreResult = host.explanationFlow.computeRestoreAfterReset({
          questionIndex: lockedIndex,
          explanationText: explanationSnapshot.explanationText,
          questionState: explanationSnapshot.questionState,
          quizId: host.quizId(),
          quizServiceQuizId: host.quizService.quizId,
          currentQuizId: host.quizService.getCurrentQuizId(),
        });
        if (!restoreResult.shouldSkip) {
          host.explanationToDisplay.set(restoreResult.explanationText);
          host.updateDisplayMode(restoreResult.displayMode);
          host.applyDisplayState(restoreResult.displayState);
          host.applyExplanationFlags(restoreResult);
          host.emitExplanationChange(restoreResult.explanationText, true);
        }
      }

      const loadResult = await host.questionLoader.performLoadQuestionPostReset({
        currentQuestionIndex: host.currentQuestionIndex(),
        questionsArray: host.questionsArray,
        quizId: host.quizId(),
        signal,
        questions: host.questions,
      });

      if (!loadResult) return false;
      if (loadResult.shouldRedirect) {
        await host.router.navigate(['/results', host.quizId()]);
        return false;
      }

      host.questionsArray = loadResult.questionsArray;
      host.currentQuestion.set(loadResult.currentQuestion);
      host.optionsToDisplay.set(loadResult.optionsToDisplay);
      host.questionToDisplay = loadResult.questionToDisplay;
      host.updateShouldRenderOptions(host.optionsToDisplay());

      const banner = host.feedbackManager.computeCorrectAnswersBanner({
        currentQuestion: host.currentQuestion(),
        currentQuestionIndex: host.currentQuestionIndex(),
      });
      host.quizService.updateCorrectAnswersText(banner.bannerText);

      if (host.sharedOptionComponent) host.sharedOptionComponent.initializeOptionBindings();
      host.cdRef.markForCheck();

      if (host.currentQuestion() && host.optionsToDisplay()?.length > 0) {
        host.questionAndOptionsReady.emit();
        host.quizService.emitQuestionAndOptions(
          host.currentQuestion(),
          host.optionsToDisplay(),
          host.currentQuestionIndex()
        );
      }

      return true;
    } catch (error) {
      console.error('[loadQuestion] Error:', error);
      host.feedbackText = 'Error loading question. Please try again.';
      host.currentQuestion.set(null);
      host.optionsToDisplay.set([]);
      return false;
    } finally {
      host.isLoading = false;
      host.quizStateService.setLoading(false);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // setupRouteChangeHandler body
  // ═══════════════════════════════════════════════════════════════
  runSetupRouteChangeHandler(host: Host): void {
    host.subscriptionWiring.createRouteChangeHandlerSubscription({
      activatedRoute: host.activatedRoute,
      getTotalQuestions: () => host.totalQuestions,
      parseRouteIndex: (rawParam: string | null) =>
        host.initializer.handleRouteChangeParsing({ rawParam, totalQuestions: host.totalQuestions }),
      onRouteChange: async (zeroBasedIndex: number, _displayIndex: number) => {
        host.currentQuestionIndex.set(zeroBasedIndex);
        host.explanationVisible = false;
        host.explanationText.set('');

        const routeResult = await host.questionLoader.performRouteChangeUpdate({
          zeroBasedIndex,
          questionsArray: host.questionsArray,
          loadQuestion: () => host.loadQuestion(),
          isAnyOptionSelected: (idx: number) => host.isAnyOptionSelected(idx),
          updateExplanationText: (idx: number) => host.updateExplanationText(idx),
          shouldDisplayExplanation: host.shouldDisplayExplanation,
          questionForm: host.questionForm,
        });

        if (!routeResult) return;
        host.currentQuestion.set(routeResult.currentQuestion);
        host.optionsToDisplay.set(routeResult.optionsToDisplay);

        if (host.shouldDisplayExplanation) {
          host.showExplanationChange.emit(true);
          const transition = host.explanationDisplay.computeExplanationModeTransition(
            host.shouldDisplayExplanation,
            host.displayMode$.getValue()
          );
          if (transition) {
            host.applyDisplayState(transition.displayState);
            host.updateDisplayMode(transition.displayMode);
            const f = transition.explanationFlags;
            host.shouldDisplayExplanation = f.shouldDisplayExplanation;
            host.explanationVisible = f.explanationVisible;
            host.forceQuestionDisplay = f.forceQuestionDisplay;
            host.readyForExplanationDisplay = f.readyForExplanationDisplay;
            host.isExplanationReady = f.isExplanationReady;
            host.isExplanationLocked = f.isExplanationLocked;
          }
        }
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // onQuestionTimedOut body
  // ═══════════════════════════════════════════════════════════════
  runOnQuestionTimedOut(host: Host, targetIndex?: number): void {
    if (host.timedOut) return;
    host.timedOut = true;
    const result = host.timerEffect.onQuestionTimedOut({
      targetIndex,
      currentQuestionIndex: host.currentQuestionIndex(),
      questions: host.questions,
      currentQuestion: host.currentQuestion(),
      optionsToDisplay: host.optionsToDisplay(),
      sharedOptionBindings: host.sharedOptionComponent?.optionBindings,
      totalQuestions: host.totalQuestions,
      formattedByIndex: host._formattedByIndex,
      lastAllCorrect: host._lastAllCorrect,
      normalizeIndex: (idx: number) => host.normalizeIndex(idx),
      setExplanationFor: (_idx: number, html: string) => {
        host.explanationTextService.setExplanationText(html);
        host.cdRef.markForCheck();
      },
      resolveFormatted: (idx: number) => host.resolveFormatted(idx),
      revealFeedbackForAllOptions: (opts: Option[]) => host.revealFeedbackForAllOptions(opts),
      forceDisableSharedOption: () => host.forceDisableSharedOption(),
      updateBindingsAndOptions: () => host.disableAllBindingsAndOptions(),
      markForCheck: () => host.cdRef.markForCheck(),
    });
    host.displayExplanation = true;
    host.showExplanationChange.emit(true);
    host.explanationToDisplay.set(result.explanationToDisplay);
    host.explanationToDisplayChange?.emit(result.explanationToDisplay);
    host._timerStoppedForQuestion = result.timerStoppedForQuestion;
  }

  // ═══════════════════════════════════════════════════════════════
  // handleTimerStoppedForActiveQuestion body
  // ═══════════════════════════════════════════════════════════════
  runHandleTimerStoppedForActiveQuestion(host: Host, reason: 'timeout' | 'stopped'): void {
    const stopped = host.timerEffect.handleTimerStoppedForActiveQuestion({
      reason,
      timerStoppedForQuestion: host._timerStoppedForQuestion,
      currentQuestionIndex: host.currentQuestionIndex(),
      questions: host.questions,
      questionFresh: host.questionFresh,
      optionsToDisplay: host.optionsToDisplay(),
      sharedOptionBindings: host.sharedOptionComponent?.optionBindings,
      currentQuestion: host.currentQuestion(),
      normalizeIndex: (idx: number) => host.normalizeIndex(idx),
      revealFeedbackForAllOptions: (opts: Option[]) => host.revealFeedbackForAllOptions(opts),
      forceDisableSharedOption: () => host.forceDisableSharedOption(),
      updateBindingsAndOptions: () => host.disableAllBindingsAndOptions(),
      markForCheck: () => host.cdRef.markForCheck(),
      detectChanges: () => host.cdRef.detectChanges(),
    });
    if (stopped) host._timerStoppedForQuestion = true;
  }

  // ═══════════════════════════════════════════════════════════════
  // onTimerExpiredFor body
  // ═══════════════════════════════════════════════════════════════
  async runOnTimerExpiredFor(host: Host, index: number): Promise<void> {
    const i0 = host.normalizeIndex(index);
    if (host.handledOnExpiry.has(i0)) return;
    host.handledOnExpiry.add(i0);
    host.onQuestionTimedOut(i0);

    host.ngZone.run(() => {
      const expiryState = host.timerEffect.applyTimerExpiryState({
        i0,
        questions: host.questions,
        currentQuestionType: host.currentQuestion()?.type,
      });
      host.feedbackText = expiryState.feedbackText;
      host.displayExplanation = expiryState.displayExplanation;
      host.showExplanationChange?.emit(true);
      host.cdRef.markForCheck();
    });

    const { formattedText, needsAsyncRepair } = await host.timerEffect.performTimerExpiredForAsync({
      i0,
      normalizeIndex: (idx: number) => host.normalizeIndex(idx),
      questions: host.questions,
      currentQuestionIndex: host.currentQuestionIndex(),
      currentQuestion: host.currentQuestion(),
      formattedByIndex: host._formattedByIndex,
      fixedQuestionIndex: host.fixedQuestionIndex,
      updateExplanationText: (idx: number) => host.updateExplanationText(idx),
    });

    if (formattedText) host.applyExplanationTextInZone(formattedText);
    if (needsAsyncRepair) {
      host.timerEffect
        .repairExplanationAsync({
          index: i0,
          normalizeIndex: (idx: number) => host.normalizeIndex(idx),
          formattedByIndex: host._formattedByIndex,
          fixedQuestionIndex: host.fixedQuestionIndex,
          currentQuestionIndex: host.currentQuestionIndex(),
          updateExplanationText: (idx: number) => host.updateExplanationText(idx),
        })
        .then((repaired: string) => {
          if (repaired) host.applyExplanationTextInZone(repaired);
        })
        .catch(() => {});
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // resetQuestionStateBeforeNavigation body
  // ═══════════════════════════════════════════════════════════════
  async runResetQuestionStateBeforeNavigation(
    host: Host,
    options?: { preserveVisualState?: boolean; preserveExplanation?: boolean }
  ): Promise<void> {
    const result = host.resetManager.computeResetQuestionStateBeforeNavigation(options);
    host.currentQuestion.set(result.currentQuestion);
    host.selectedOption = result.selectedOption;
    host.options.set(result.resetOptions);

    if (!result.preserveExplanation) {
      host.feedbackText = result.feedbackText;
      host.applyDisplayState(result.displayState);
      host.quizStateService.setDisplayState(host.displayState);
      host.updateDisplayMode(result.displayMode);
      host.applyExplanationFlags(result);
      host.explanationToDisplay.set(result.explanationToDisplay);
      host.emitExplanationChange('', false);
    }
    if (!result.preserveVisualState) {
      host.questionToDisplay = '';
      host.updateShouldRenderOptions([]);
      host.shouldRenderOptions.set(false);
    }

    host.finalRenderReadySubject.next(false);
    host.renderReadySubject.next(false);
    setTimeout(() => {
      if (host.sharedOptionComponent) {
        host.sharedOptionComponent.freezeOptionBindings = false;
        host.sharedOptionComponent.showFeedbackForOption = {};
      }
    }, 0);

    const resetDelay = host.resetManager.computeResetDelay(result.preserveVisualState);
    if (resetDelay > 0) await new Promise((resolve) => setTimeout(resolve, resetDelay));
  }

  // ═══════════════════════════════════════════════════════════════
  // resetPerQuestionState body
  // ═══════════════════════════════════════════════════════════════
  runResetPerQuestionState(host: Host, index: number): void {
    if (host._pendingRAF != null) {
      cancelAnimationFrame(host._pendingRAF);
      host._pendingRAF = null;
    }
    host._skipNextAsyncUpdates = false;

    const result = host.resetManager.resetPerQuestionState({
      index,
      normalizeIndex: (idx: number) => host.normalizeIndex(idx),
      formattedByIndex: host._formattedByIndex,
      clearSharedOptionForceDisable: () => host.sharedOptionComponent?.clearForceDisableAllOptions?.(),
      resolveFormatted: (idx: number, opts: any) => host.resolveFormatted(idx, opts),
    });

    host.handledOnExpiry.delete(result.i0);
    host.feedbackConfigs = result.feedbackConfigs;
    host.lastFeedbackOptionId = result.lastFeedbackOptionId;
    host.showFeedbackForOption = result.showFeedbackForOption;

    if (result.hasSelections) {
      host.optionsToDisplay.set(host.resetManager.restoreSelectionsAndIcons(result.i0, host.optionsToDisplay()));
      host.cdRef.detectChanges();
    }

    host.displayExplanation = result.displayExplanation;
    host.updateDisplayMode(result.displayMode);
    if (result.hasSelections) {
      host.showExplanationChange?.emit(true);
    } else {
      host.explanationToDisplay.set('');
      host.emitExplanationChange('', false);
    }

    host.questionFresh = result.questionFresh;
    host.timedOut = result.timedOut;
    host._timerStoppedForQuestion = result.timerStoppedForQuestion;
    host._lastAllCorrect = result.lastAllCorrect;
    host.lastLoggedIndex = result.lastLoggedIndex;
    host.lastLoggedQuestionIndex = result.lastLoggedQuestionIndex;

    try {
      host.questionForm?.enable({ emitEvent: false });
    } catch {}
    queueMicrotask(() => host.emitPassiveNow(index));
    host.cdRef.markForCheck();
    host.cdRef.detectChanges();
  }

  // ═══════════════════════════════════════════════════════════════
  // updateExplanationDisplay body
  // ═══════════════════════════════════════════════════════════════
  async runUpdateExplanationDisplay(host: Host, shouldDisplay: boolean): Promise<void> {
    host.showExplanationChange.emit(shouldDisplay);
    host.displayExplanation = shouldDisplay;
    if (shouldDisplay) {
      setTimeout(async () => {
        const result = await host.explanationDisplay.performUpdateExplanationDisplay({
          shouldDisplay: true,
          currentQuestionIndex: host.currentQuestionIndex(),
        });
        host.explanationToDisplay.set(result.explanationToDisplay);
        host.explanationToDisplayChange.emit(result.explanationToDisplay);
        host.cdRef.markForCheck();
      }, 50);
    } else {
      const result = await host.explanationDisplay.performUpdateExplanationDisplay({
        shouldDisplay: false,
        currentQuestionIndex: host.currentQuestionIndex(),
      });
      if (result.explanationToDisplay !== undefined) {
        host.explanationToDisplay.set(result.explanationToDisplay);
        host.explanationToDisplayChange.emit(result.explanationToDisplay);
      }
      if (result.shouldResetQuestionState) host.resetQuestionStateBeforeNavigation();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // fetchAndSetExplanationText body
  // ═══════════════════════════════════════════════════════════════
  async runFetchAndSetExplanationText(host: Host, questionIndex: number): Promise<void> {
    host.resetExplanation();

    const ensureLoaded = async () => {
      const r = await host.questionLoader.ensureQuestionsLoaded(host.questionsArray, host.quizId());
      if (r.loaded && r.questions) {
        host.questions = r.questions;
        host.questionsArray = r.questions;
      }
      return r.loaded;
    };

    const result = await host.explanationFlow.performFetchAndSetExplanation({
      questionIndex,
      questionsArray: host.questionsArray,
      quizId: host.quizId(),
      isAnswered: host.isAnswered as boolean,
      shouldDisplayExplanation: host.shouldDisplayExplanation,
      ensureQuestionsLoaded: ensureLoaded,
      ensureQuestionIsFullyLoaded: (idx: number) =>
        host.questionLoader.ensureQuestionIsFullyLoaded(idx, host.questionsArray, host.quizId()),
      prepareExplanationText: (idx: number) => host.prepareAndSetExplanationText(idx),
      isAnyOptionSelected: (idx: number) => host.isAnyOptionSelected(idx),
    });

    if (result.success) {
      host.currentQuestionIndex.set(questionIndex);
      host.explanationToDisplay.set(result.explanationToDisplay);
      host.explanationTextService.updateFormattedExplanation(host.explanationToDisplay());
      host.explanationToDisplayChange.emit(host.explanationToDisplay());
    } else if (result.explanationToDisplay) {
      host.explanationToDisplay.set(host.explanationFlow.getExplanationErrorText());
      if (host.isAnswered && host.shouldDisplayExplanation) {
        host.emitExplanationChange(host.explanationToDisplay(), true);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // updateExplanationUI body
  // ═══════════════════════════════════════════════════════════════
  runUpdateExplanationUI(host: Host, questionIndex: number, explanationText: string): void {
    const validated = host.explanationFlow.performUpdateExplanationUI({
      questionsArray: host.questionsArray,
      questionIndex,
    });
    if (!validated) return;

    try {
      host.quizService.setCurrentQuestion(validated.currentQuestion);
      new Promise<void>((resolve) => setTimeout(resolve, 100))
        .then(async () => {
          if (host.shouldDisplayExplanation && (await host.isAnyOptionSelected(validated.adjustedIndex))) {
            host.emitExplanationChange('', false);
            host.explanationToDisplay.set(explanationText);
            host.emitExplanationChange(host.explanationToDisplay(), true);
            host.isAnswerSelectedChange.emit(true);
          }
        })
        .catch(() => {});
    } catch {}
  }

  // ═══════════════════════════════════════════════════════════════
  // handleOptionSelection body
  // ═══════════════════════════════════════════════════════════════
  async runHandleOptionSelection(
    host: Host,
    option: SelectedOption,
    optionIndex: number,
    currentQuestion: QuizQuestion
  ): Promise<void> {
    const result = await host.optionSelection.handleFullOptionSelection({
      option,
      optionIndex,
      currentQuestion,
      currentQuestionIndex: host.currentQuestionIndex(),
      quizId: host.quizId()!,
      lastAllCorrect: host._lastAllCorrect,
      optionsToDisplay: host.optionsToDisplay(),
      handleOptionClickedFn: async (q: QuizQuestion, idx: number) => {
        const r = host.optionSelection.handleOptionClicked({
          currentQuestion: q,
          optionIndex: idx,
          currentQuestionIndex: host.currentQuestionIndex(),
        });
        if (r) host.cdRef.markForCheck();
      },
      updateExplanationTextFn: (idx: number) => host.updateExplanationText(idx),
    });
    if (!result) return;
    host.selectedOption = result.selectedOption;
    host.showFeedback.set(result.showFeedback);
    host.showFeedbackForOption = result.showFeedbackForOption;
    host.selectedOptionIndex = result.selectedOptionIndex;
    host.explanationText.set(result.explanationText);
    host.applyFeedbackIfNeeded(option);
    host.optionSelection.setAnsweredAndDisplayState(host._lastAllCorrect);
  }

  // ═══════════════════════════════════════════════════════════════
  // updateOptionsSafely body
  // ═══════════════════════════════════════════════════════════════
  runUpdateOptionsSafely(host: Host, newOptions: Option[]): void {
    const result = host.displayStateManager.prepareOptionSwap({
      newOptions,
      currentOptionsJson: JSON.stringify(host.optionsToDisplay()),
    });

    if (result.needsSwap) {
      host.renderReadySubject.next(false);
      host.finalRenderReady = false;
      host.questionForm = result.formGroup;
      if (result.serialized !== host.lastSerializedOptions) {
        host.lastSerializedOptions = result.serialized;
      }
      host.optionsToDisplay.set(result.cleanedOptions);
      if (host.sharedOptionComponent) {
        host.sharedOptionComponent.initializeOptionBindings();
      }
      setTimeout(() => {
        if (host.displayStateManager.computeRenderReadiness(host.optionsToDisplay())) {
          host.markRenderReady();
        }
      }, 0);
    } else if (
      host.displayStateManager.computeRenderReadiness(host.optionsToDisplay()) &&
      !host.finalRenderReady
    ) {
      host.markRenderReady();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // hydrateFromPayload body
  // ═══════════════════════════════════════════════════════════════
  runHydrateFromPayload(host: Host, payload: any): void {
    const result = host.displayStateManager.hydrateFromPayload({
      payload,
      currentQuestionText: host.currentQuestion()?.questionText?.trim(),
      isAlreadyRendered: host.finalRenderReady,
    });
    if (!result) return;

    host.renderReady = false;
    host.finalRenderReady = false;
    host.renderReadySubject.next(false);
    host.finalRenderReadySubject.next(false);
    host.cdRef.detectChanges();

    host.currentQuestion.set(result.currentQuestion);
    host.optionsToDisplay.set(result.optionsToDisplay);
    host.updateShouldRenderOptions(host.optionsToDisplay());
    host.explanationToDisplay.set(result.explanationToDisplay);

    if (!host.containerInitialized && host.dynamicAnswerContainer) {
      host.loadDynamicComponent(host.currentQuestion(), host.optionsToDisplay());
      host.containerInitialized = true;
    }
    host.sharedOptionComponent?.initializeOptionBindings();

    setTimeout(() => {
      const bindingsReady =
        Array.isArray(host.sharedOptionComponent?.optionBindings) &&
        host.sharedOptionComponent.optionBindings.length > 0 &&
        host.sharedOptionComponent.optionBindings.every((b: any) => !!b.option);
      if (
        host.displayStateManager.computeRenderReadiness(host.optionsToDisplay()) &&
        bindingsReady
      ) {
        host.sharedOptionComponent?.markRenderReady('✅ Hydrated from new payload');
      }
    }, 0);
  }

  // ═══════════════════════════════════════════════════════════════
  // updateExplanationIfAnswered body
  // ═══════════════════════════════════════════════════════════════
  async runUpdateExplanationIfAnswered(host: Host, index: number, question: QuizQuestion): Promise<void> {
    const result = await host.explanationFlow.updateExplanationIfAnswered({
      index,
      question,
      shouldDisplayExplanation: host.shouldDisplayExplanation,
      isAnyOptionSelected: (idx: number) => host.isAnyOptionSelected(idx),
      getFormattedExplanation: (q: QuizQuestion, idx: number) =>
        host.explanationManager.getFormattedExplanation(q, idx),
    });
    if (result.shouldUpdate) {
      host.explanationToDisplay.set(result.explanationText);
      host.emitExplanationChange(host.explanationToDisplay(), true);
      host.isAnswerSelectedChange.emit(true);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // handlePageVisibilityChange body
  // ═══════════════════════════════════════════════════════════════
  runHandlePageVisibilityChange(host: Host, isHidden: boolean): void {
    const action = host.navigationHandler.computeVisibilityAction(isHidden);
    if (action.shouldClearSubscriptions) {
      host.displaySubscriptions?.forEach((sub: Subscription) => sub.unsubscribe());
      host.displaySubscriptions = [];
      const cleanup = host.navigationHandler.computeDisplaySubscriptionCleanup();
      host.explanationToDisplay.set(cleanup.explanationToDisplay);
      host.emitExplanationChange('', cleanup.showExplanation);
    }
    if (action.shouldRefreshExplanation) {
      host.prepareAndSetExplanationText(host.currentQuestionIndex());
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // initializeQuiz body
  // ═══════════════════════════════════════════════════════════════
  async runInitializeQuiz(host: Host): Promise<void> {
    if (host.initialized) return;
    host.initialized = true;

    host.quizId.set(host.activatedRoute.snapshot.paramMap.get('quizId'));
    host.isLoading = true;
    try {
      const result = await host.initializer.performFullQuizInit({
        currentQuestionIndex: host.currentQuestionIndex(),
        questionsArray: host.questionsArray,
        routeQuizId: host.quizId(),
        setQuestionOptions: () => host.setQuestionOptions(),
        questionLoader: host.questionLoader,
        prepareExplanationForQuestion: (p: any) => host.initializer.prepareExplanationForQuestion(p),
        getExplanationText: (idx: number) => host.explanationManager.getExplanationText(idx),
      });
      if (result) {
        host.questionsArray = result.questionsArray;
        host.questions = result.questions;
        host.quizId.set(result.quizId);
      }
    } finally {
      host.isLoading = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // isAnyOptionSelected body
  // ═══════════════════════════════════════════════════════════════
  async runIsAnyOptionSelected(host: Host, questionIndex: number): Promise<boolean> {
    const rs = host.optionSelection.resetStateForNewQuestion();
    host.showFeedbackForOption = rs.showFeedbackForOption;
    host.showFeedback.set(rs.showFeedback);
    host.correctMessage.set(rs.correctMessage);
    host.selectedOption = rs.selectedOption;
    host.isOptionSelected.set(rs.isOptionSelected);
    host.emitExplanationChange('', false);
    try {
      return await firstValueFrom(host.quizService.isAnswered(questionIndex));
    } catch {
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // onSubmitMultiple body
  // ═══════════════════════════════════════════════════════════════
  async runOnSubmitMultiple(host: Host): Promise<void> {
    const idx = host.currentQuestionIndex() ?? host.quizService.getCurrentQuestionIndex() ?? 0;
    const computed = host.explanationFlow.computeSubmitMultipleExplanation({ currentQuestionIndex: idx });
    if (!computed) return;
    await host.explanationFlow.applySubmitMultipleExplanation({
      currentQuestionIndex: idx,
      formatted: computed.formatted,
      correctAnswersText: computed.correctAnswersText,
      questionType: computed.questionType,
    });
    host.displayStateSubject?.next({ mode: 'explanation', answered: true });
    host.displayExplanation = true;
    host.explanationToDisplay.set(computed.formatted);
    host.explanationToDisplayChange?.emit(computed.formatted);
  }

  // ═══════════════════════════════════════════════════════════════
  // postClickTasks body
  // ═══════════════════════════════════════════════════════════════
  async runPostClickTasks(
    host: Host,
    opt: SelectedOption,
    idx: number,
    checked: boolean,
    wasPreviouslySelected: boolean,
    questionIndex?: number
  ): Promise<void> {
    const lockedIndex = questionIndex ?? host.currentQuestionIndex();
    const { sel, shouldUpdateGlobalState } = host.optionSelection.performPostClickTasks({
      opt,
      idx,
      questionIndex: lockedIndex,
      quizId: host.quizId()!,
      lastAllCorrect: host._lastAllCorrect,
      currentQuestionIndex: host.currentQuestionIndex(),
    });
    await host.finalizeSelection(opt, idx, wasPreviouslySelected);
    host.optionSelected.emit(sel);
    host.events.emit({ type: 'optionSelected', payload: sel });
    if (shouldUpdateGlobalState) host.nextButtonStateService.setNextButtonState(true);
    host.cdRef.markForCheck();
  }

  // ═══════════════════════════════════════════════════════════════
  // performInitialSelectionFlow body
  // ═══════════════════════════════════════════════════════════════
  async runPerformInitialSelectionFlow(host: Host, event: any, option: SelectedOption): Promise<void> {
    const prevSelected = !!option.selected;
    host.optionSelection.updateOptionSelection(event, option, host.currentQuestionIndex());
    await host.handleOptionSelection(option, event.index, host.currentQuestion()!);
    host.applyFeedbackIfNeeded(option);
    const nowSelected = !!option.selected;
    const transition = host.feedbackManager.computeSelectionTransition({
      prevSelected,
      nowSelected,
      option,
      currentQuestionIndex: host.currentQuestionIndex(),
    });
    host.optionSelection.handleSelectionTransitionAndMessage({
      prevSelected,
      nowSelected,
      transition,
      currentQuestionIndex: host.currentQuestionIndex(),
      optionsToDisplay: host.optionsToDisplay(),
      currentQuestionOptions: host.currentQuestion()?.options,
      isAnswered: host.isAnswered as boolean,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // applyFeedbackIfNeeded body
  // ═══════════════════════════════════════════════════════════════
  async runApplyFeedbackIfNeeded(host: Host, option: SelectedOption): Promise<void> {
    if (!host.optionsToDisplay()?.length) host.populateOptionsToDisplay();
    const result = host.feedbackManager.applyFeedbackIfNeeded({
      option,
      optionsToDisplay: host.optionsToDisplay(),
      showFeedbackForOption: host.showFeedbackForOption,
    });
    if (!result) return;
    host.showFeedbackForOption = result.showFeedbackForOption;
    host.selectedOptionIndex = result.selectedOptionIndex;
    if (result.shouldTriggerExplanation) {
      host.explanationTextService.triggerExplanationEvaluation();
    }
    host.cdRef.detectChanges();
  }

  // ═══════════════════════════════════════════════════════════════
  // applyOptionFeedback body
  // ═══════════════════════════════════════════════════════════════
  async runApplyOptionFeedback(host: Host, selectedOption: Option): Promise<void> {
    if (!host.optionsToDisplay()?.length) host.populateOptionsToDisplay();
    const result = host.feedbackManager.applyOptionFeedback(
      selectedOption,
      host.optionsToDisplay(),
      host.showFeedbackForOption
    );
    if (!result) return;
    host.optionsToDisplay.set(result.optionsToDisplay);
    host.showFeedbackForOption = result.showFeedbackForOption;
    host.selectedOptionIndex = result.selectedOptionIndex;
    host.feedbackApplied.emit(selectedOption.optionId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    host.cdRef.markForCheck();
  }

  // ═══════════════════════════════════════════════════════════════
  // finalizeSelection body
  // ═══════════════════════════════════════════════════════════════
  async runFinalizeSelection(
    host: Host,
    option: SelectedOption,
    index: number,
    wasPreviouslySelected: boolean
  ): Promise<void> {
    const result = await host.optionSelection.performFinalizeSelection({
      option,
      index,
      wasPreviouslySelected,
      currentQuestionIndex: host.currentQuestionIndex(),
      quizId: host.quizId()!,
      lastAllCorrect: host._lastAllCorrect,
      fetchAndProcessCurrentQuestion: () => host.fetchAndProcessCurrentQuestion(),
      selectOption: (q: QuizQuestion, opt: SelectedOption, idx: number) => host.selectOption(q, opt, idx),
      processCurrentQuestion: (q: QuizQuestion) =>
        host.explanationFlow.processCurrentQuestion({
          currentQuestion: q,
          currentQuestionIndex: host.currentQuestionIndex(),
          quizId: host.quizId()!,
          lastAllCorrect: host._lastAllCorrect,
          getExplanationText: (idx: number) => host.explanationManager.getExplanationText(idx),
        }),
      handleOptionSelection: (opt: SelectedOption, idx: number, q: QuizQuestion) =>
        host.handleOptionSelection(opt, idx, q),
    });
    if (!result) return;
    host.updateExplanationDisplay(result.shouldDisplay);
    host.questionAnswered.emit();
    host.timerEffect.stopTimerIfAllCorrectSelected({
      currentQuestionIndex: host.currentQuestionIndex(),
      questions: host.questions,
      optionsToDisplay: host.optionsToDisplay(),
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // fetchAndProcessCurrentQuestion body
  // ═══════════════════════════════════════════════════════════════
  async runFetchAndProcessCurrentQuestion(host: Host): Promise<QuizQuestion | null> {
    const result = await host.optionSelection.fetchAndProcessCurrentQuestion({
      currentQuestionIndex: host.currentQuestionIndex(),
      isAnyOptionSelectedFn: (idx: number) => host.isAnyOptionSelected(idx),
      shouldUpdateMessageOnAnswerFn: async (isAnswered: boolean) =>
        host.selectionMessage() !==
        host.selectionMessageService.determineSelectionMessage(
          host.currentQuestionIndex(),
          host.totalQuestions,
          isAnswered
        ),
    });
    if (!result) return null;
    host.currentQuestion.set(result.currentQuestion);
    host.optionsToDisplay.set(result.optionsToDisplay);
    host.data.set(result.data);
    return result.currentQuestion;
  }

  // ═══════════════════════════════════════════════════════════════
  // selectOption body
  // ═══════════════════════════════════════════════════════════════
  async runSelectOption(
    host: Host,
    currentQuestion: QuizQuestion,
    option: SelectedOption,
    optionIndex: number
  ): Promise<void> {
    const result = await host.optionSelection.performSelectOption({
      currentQuestion,
      option,
      optionIndex,
      currentQuestionIndex: host.currentQuestionIndex(),
      isMultipleAnswer: host.isMultipleAnswer,
      optionsToDisplay: host.optionsToDisplay(),
      selectedOptionsCount: host.selectedOptions.length,
      getExplanationText: (idx: number) => host.explanationManager.getExplanationText(idx),
    });
    if (!result) return;
    host.showFeedbackForOption = result.showFeedbackForOption;
    host.selectedOption = result.selectedOption;
    host.isOptionSelected.set(result.isOptionSelected);
    host.isAnswered = result.isAnswered;
    host.quizQuestionManagerService.setExplanationText(currentQuestion.explanation || '');
    host.isAnswerSelectedChange.emit(host.isAnswered);
    host.optionSelected.emit(result.selectedOption);
    host.events.emit({ type: 'optionSelected', payload: result.selectedOption });
    host.selectionChanged.emit({ question: currentQuestion, selectedOptions: host.selectedOptions });
  }

  // ═══════════════════════════════════════════════════════════════
  // handleQuestionAndOptionsChange body
  // ═══════════════════════════════════════════════════════════════
  runHandleQuestionAndOptionsChange(host: Host, currentQuestionChange: any, optionsChange: any): void {
    const { nextQuestion, effectiveQuestion, incomingOptions } =
      host.displayStateManager.handleQuestionAndOptionsChange({
        currentQuestionChange,
        optionsChange,
        currentQuestion: host.currentQuestion(),
      });
    if (nextQuestion) host.currentQuestion.set(nextQuestion);
    const normalizedOptions = host.refreshOptionsForQuestion(effectiveQuestion, incomingOptions);
    const selectedOptionValues = host.displayStateManager.extractSelectedOptionValues(effectiveQuestion);
    if (effectiveQuestion) {
      host.quizService.handleQuestionChange(effectiveQuestion, selectedOptionValues, normalizedOptions);
    } else if (optionsChange) {
      host.quizService.handleQuestionChange(null, selectedOptionValues, normalizedOptions);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // refreshOptionsForQuestion body
  // ═══════════════════════════════════════════════════════════════
  runRefreshOptionsForQuestion(
    host: Host,
    question: QuizQuestion | null,
    providedOptions?: Option[] | null
  ): Option[] {
    const result = host.displayStateManager.refreshOptionsForQuestion({
      question,
      providedOptions,
      currentQuestionIndex: host.currentQuestionIndex(),
    });
    host.options.set(result.options);
    host.optionsToDisplay.set(result.optionsToDisplay);
    if (host.optionsToDisplay().length > 0) {
      host.quizService.setOptions(host.optionsToDisplay().map((option: Option) => ({ ...option })));
    }
    host.cdRef.markForCheck();
    return result.normalizedOptions;
  }

  // ═══════════════════════════════════════════════════════════════
  // initializeQuizDataAndRouting body
  // ═══════════════════════════════════════════════════════════════
  async runInitializeQuizDataAndRouting(host: Host): Promise<void> {
    const result = await host.questionLoader.performQuizDataAndRoutingInit({ quizId: host.quizId() });
    if (!result) return;

    host.questions = result.questions;
    host.questionsArray = result.questions;
    if (result.quiz) host.quiz = result.quiz;
    if (!host.quiz) return;

    host.quizService.questionsLoaded$.pipe(take(1), debounceTime(100)).subscribe((loaded: boolean) => {
      if (loaded) host.setupRouteChangeHandler();
    });
  }

  // ─── Misc thin wrappers (extracted from QuizQuestionComponent) ───

  runApplyExplanationTextInZone(host: Host, text: string): void {
    host.ngZone.run(() => {
      host.explanationToDisplay.set(text);
      host.explanationToDisplayChange.emit(text);
      host.cdRef.markForCheck();
      host.cdRef.detectChanges();
    });
  }

  runApplyExplanationFlags(host: Host, flags: any): void {
    host.forceQuestionDisplay = flags.forceQuestionDisplay;
    host.readyForExplanationDisplay = flags.readyForExplanationDisplay;
    host.isExplanationReady = flags.isExplanationReady;
    host.isExplanationLocked = flags.isExplanationLocked;
    host.explanationLocked = flags.explanationLocked;
    host.explanationVisible = flags.explanationVisible;
    host.displayExplanation = flags.displayExplanation;
    host.shouldDisplayExplanation = flags.shouldDisplayExplanation;
  }

  runSetQuestionOptions(host: Host): void {
    host.quizService.getQuestionByIndex(host.currentQuestionIndex()).pipe(take(1)).subscribe((currentQuestion: QuizQuestion | null) => {
      if (!currentQuestion) return;
      host.currentQuestion.set(currentQuestion);
      host.currentOptions = host.displayStateManager.buildOptionsWithCorrectness(currentQuestion);
      if (host.currentOptions.length === 0) return;
      if (host.shuffleOptions) Utils.shuffleArray(host.currentOptions);
      host.currentOptions = host.displayStateManager.applyDisplayOrder(host.currentOptions);
      host.optionsToDisplay.set(host.currentOptions.map((o: any) => ({ ...o })));
      host.updateShouldRenderOptions(host.optionsToDisplay());
      host.quizService.nextOptionsSubject.next(host.optionsToDisplay().map((o: any) => ({ ...o })));
      host.cdRef.markForCheck();
    });
  }

  runResetState(host: Host): void {
    const result = host.resetManager.resetState();
    host.selectedOption = result.selectedOption;
    host.options.set(result.options);
    host.resetFeedback();
  }

  runResetFeedback(host: Host): void {
    const result = host.resetManager.resetFeedback();
    host.correctMessage.set(result.correctMessage);
    host.showFeedback.set(result.showFeedback);
    host.selectedOption = result.selectedOption;
    host.showFeedbackForOption = result.showFeedbackForOption;
  }

  runUpdateOptionHighlighting(host: Host, selectedKeys: Set<string | number>): void {
    host.optionsToDisplay.set(host.feedbackManager.updateOptionHighlighting(host.optionsToDisplay(), selectedKeys, host.currentQuestionIndex(), host.question()?.type));
    host.cdRef.markForCheck();
    host.cdRef.detectChanges();
  }

  runRefreshFeedbackFor(host: Host, opt: Option): void {
    if (!host.sharedOptionComponent) return;
    if (opt.optionId !== undefined) host.sharedOptionComponent.lastFeedbackOptionId = opt.optionId;
    const cfg = host.feedbackManager.buildFeedbackConfigForOption(opt, host.optionBindings(), host.currentQuestion()!, host.sharedOptionComponent.feedbackConfigs);
    host.sharedOptionComponent.feedbackConfigs = { ...host.sharedOptionComponent.feedbackConfigs, [opt.optionId!]: cfg };
    host.cdRef.markForCheck();
  }

  runPopulateOptionsToDisplay(host: Host): Option[] {
    const result = host.questionLoader.populateOptionsToDisplay(host.currentQuestion(), host.optionsToDisplay(), host.lastOptionsQuestionSignature);
    host.optionsToDisplay.set(result.options);
    host.lastOptionsQuestionSignature = result.signature;
    return host.optionsToDisplay();
  }

  runInitializeForm(host: Host): void {
    const form = host.initializer.buildFormFromOptions(host.currentQuestion(), host.fb);
    if (form) {
      host.questionForm = form;
    }
  }

  runUnselectOption(host: Host): void {
    const result = host.optionSelection.unselectOption(host.currentQuestionIndex());
    host.selectedOptions = result.selectedOptions;
    host.optionChecked = result.optionChecked;
    host.showFeedbackForOption = result.showFeedbackForOption;
    host.showFeedback.set(result.showFeedback);
    host.selectedOption = result.selectedOption;
  }

  runResetExplanation(host: Host, force = false): void {
    const result = host.explanationFlow.performResetExplanation({ force, questionIndex: host.fixedQuestionIndex ?? host.currentQuestionIndex() ?? 0 });
    host.displayExplanation = result.displayExplanation;
    host.explanationToDisplay.set(result.explanationToDisplay);
    if (!result.blocked) {
      host.emitExplanationChange('', false);
      host.cdRef?.markForCheck?.();
    }
  }

  async runPrepareAndSetExplanationText(host: Host, questionIndex: number): Promise<string> {
    host.explanationToDisplay.set(await host.explanationFlow.prepareExplanationText(questionIndex));
    return host.explanationToDisplay();
  }

  async runUpdateExplanationText(host: Host, index: number): Promise<string> {
    return host.explanationDisplay.updateExplanationText({ index, normalizeIndex: (idx: number) => host.normalizeIndex(idx), questionsArray: host.questionsArray, currentQuestionIndex: host.currentQuestionIndex(), currentQuestion: host.currentQuestion(), optionsToDisplay: host.optionsToDisplay(), options: host.options });
  }

  async runOnSubmit(host: Host): Promise<void> {
    if (!host.initializer.validateFormForSubmission(host.questionForm)) return;
    const selectedOption = host.questionForm.get('selectedOption')?.value;
    await host.initializer.processAnswer({ selectedOption, currentQuestion: host.currentQuestion()!, currentQuestionIndex: host.currentQuestionIndex(), answers: host.answers });
    host.questionAnswered.emit();
  }

  runRestoreSelectionsAndIconsForQuestion(host: Host, index: number): void {
    host.optionsToDisplay.set(host.resetManager.restoreSelectionsAndIcons(index, host.optionsToDisplay()));
    host.cdRef.detectChanges();
  }

  runResetForQuestion(host: Host, index: number): void {
    const guards = host.resetManager.hardResetClickGuards();
    host._clickGate = guards.clickGate;
    host.waitingForReady = guards.waitingForReady;
    host.deferredClick = guards.deferredClick;
    host.lastLoggedQuestionIndex = guards.lastLoggedQuestionIndex;
    host.lastLoggedIndex = guards.lastLoggedIndex;
    host.resetExplanation(true);
    host.resetPerQuestionState(index);
  }

  async runResolveFormatted(host: Host, index: number, opts: { useCache?: boolean; setCache?: boolean; timeoutMs?: number } = {}): Promise<string> {
    return host.timerEffect.resolveFormatted({ index, normalizeIndex: (idx: number) => host.normalizeIndex(idx), formattedByIndex: host._formattedByIndex, useCache: opts.useCache, setCache: opts.setCache, timeoutMs: opts.timeoutMs, updateExplanationText: (idx: number) => host.updateExplanationText(idx) });
  }

  runEmitPassiveNow(host: Host, index: number): void {
    host.optionSelection.emitPassiveNow({
      index,
      normalizeIndex: (idx: number) => host.normalizeIndex(idx),
      optionsToDisplay: host.optionsToDisplay(),
      currentQuestionType: host.currentQuestion()?.type,
    });
  }

  runDisableAllBindingsAndOptions(host: Host): { optionBindings: any[]; optionsToDisplay: Option[] } {
    const result = host.displayStateManager.disableAllBindingsAndOptions(host.optionBindings(), host.optionsToDisplay());
    host.optionBindings.set(result.optionBindings);
    host.optionsToDisplay.set(result.optionsToDisplay);
    return result;
  }

  runRevealFeedbackForAllOptions(host: Host, canonicalOpts: Option[]): void {
    const result = host.feedbackManager.revealFeedbackForAllOptions(canonicalOpts, host.feedbackConfigs, host.showFeedbackForOption);
    host.feedbackConfigs = result.feedbackConfigs;
    host.showFeedbackForOption = result.showFeedbackForOption;
    host.cdRef.markForCheck();
  }

  runUpdateShouldRenderOptions(host: Host, options: Option[] | null | undefined): void {
    const v = host.displayStateManager.computeRenderReadiness(options);
    if (host.shouldRenderOptions() !== v) {
      host.shouldRenderOptions.set(v);
      host.cdRef.markForCheck();
    }
  }

  runSafeSetDisplayState(host: Host, state: { mode: 'question' | 'explanation'; answered: boolean }): void {
    if (host.displayStateManager.shouldSuppressDisplayState({
      visibilityRestoreInProgress: host._visibilityRestoreInProgress,
      suppressDisplayStateUntil: host._suppressDisplayStateUntil,
    })) {
      return;
    }
    host.displayStateSubject?.next(state);
  }
}
