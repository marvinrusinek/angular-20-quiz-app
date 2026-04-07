import { Injectable } from '@angular/core';
import { ParamMap } from '@angular/router';
import {
  BehaviorSubject, combineLatest, firstValueFrom,
  forkJoin, Observable, of, Subject
} from 'rxjs';
import {
  catchError, debounceTime, distinctUntilChanged, filter, map,
  shareReplay, startWith, switchMap, take, takeUntil,
  tap, withLatestFrom
} from 'rxjs/operators';

import { CombinedQuestionDataType } from '../../../models/CombinedQuestionDataType.model';
import { Option } from '../../../models/Option.model';
import { QuestionType } from '../../../models/question-type.enum';
import { QuestionPayload } from '../../../models/QuestionPayload.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';

type Host = any;

/**
 * Orchestrates CodelabQuizContentComponent logic, extracted via host: any pattern.
 */
@Injectable({ providedIn: 'root' })
export class CqcOrchestratorService {

  async runOnInit(host: Host): Promise<void> {
    host.resetInitialState();

    host.quizStateService._hasUserInteracted?.clear();
    host.quizStateService.resetInteraction();

    host.setupQuestionResetSubscription();
    host.resetExplanationService();

    host.setupShouldShowFet();
    host.setupFetToDisplay();

    host.initDisplayTextPipeline();
    host.subscribeToDisplayText();
    host.setupContentAvailability();

    host.emitContentAvailableState();
    host.loadQuizDataFromRoute();
    await host.initializeComponent();
    host.setupCorrectAnswersTextDisplay();

    host.quizService.questions$
      .pipe(
        takeUntil(host.destroy$),
        filter((qs: any) => Array.isArray(qs) && qs.length > 0)
      )
      .subscribe(() => {
        console.log('[CQCC] ♻️ Questions updated - FET will be generated on-demand when user clicks');
      });

    host._cqcVisibilityHandler = () => {
      if (document.visibilityState !== 'visible') return;
      const replay = () => {
        const el = host.qText?.nativeElement;
        const cached = host._lastDisplayedText;
        if (!el || !cached) return;
        const current = (el.innerHTML ?? '').trim();
        if (!current || current !== cached.trim()) {
          host.renderer.setProperty(el, 'innerHTML', cached);
          console.log('[CQCC visibility] 🔁 Replayed cached question text');
        }
      };
      // Replay at several points to win races with the QQC visibility-restore
      // flow (which runs async with ~350ms + 400ms setTimeouts and may
      // overwrite or clear the qText DOM).
      replay();
      setTimeout(replay, 100);
      setTimeout(replay, 500);
      setTimeout(replay, 900);
    };
    document.addEventListener('visibilitychange', host._cqcVisibilityHandler);

    host.timerService.expired$
      .pipe(takeUntil(host.destroy$))
      .subscribe(() => {
        const idx = host.currentIndex >= 0 ? host.currentIndex : (host.quizService.getCurrentQuestionIndex?.() ?? host.currentQuestionIndexValue ?? 0);

        console.warn(`[CQCC] ⏰ Timer expired for Q${idx + 1} → allow FET display`);
        host.timedOutIdxSubject.next(idx);

        const isShuffled = host.quizService.isShuffleEnabled?.() && Array.isArray(host.quizService.shuffledQuestions) && host.quizService.shuffledQuestions.length > 0;
        let q = isShuffled
          ? host.quizService.shuffledQuestions[idx]
          : host.quizService.questions?.[idx];

        q = q ?? (host.quizService?.currentQuestion?.value ?? null);

        if (q?.explanation) {
          const visualOpts = host.quizQuestionComponent?.optionsToDisplay ?? q.options;
          host.explanationTextService.storeFormattedExplanation(idx, q.explanation, q, visualOpts);
        }

        host.cdRef.markForCheck();
      });
  }

  runOnDestroy(host: Host): void {
    if (host._cqcVisibilityHandler) {
      document.removeEventListener('visibilitychange', host._cqcVisibilityHandler);
      host._cqcVisibilityHandler = null;
    }
    host.destroy$.next();
    host.destroy$.complete();
    host.correctAnswersTextSource.complete();
    host.correctAnswersDisplaySubject.complete();
    host.combinedTextSubject.complete();
    host.combinedSub?.unsubscribe();
  }

  runQuestionIndexSet(host: Host, idx: number): void {
    host.currentIndex = idx;
    host._fetLocked = false;
    host._lockedForIndex = -1;
    host.timedOutIdxSubject.next(-1);

    if (host.qText?.nativeElement) {
      host.renderer.setProperty(host.qText.nativeElement, 'innerHTML', '');
    }

    host.overrideSubject.next({ idx, html: '' });
    host.questionIndexSubject.next(idx);
    host.clearCachedQuestionArtifacts(idx);

    const ets = host.explanationTextService;
    ets._activeIndex = idx;

    const isShuffled = host.quizService.isShuffleEnabled() && Array.isArray(host.quizService.shuffledQuestions) && host.quizService.shuffledQuestions.length > 0;
    const currentQuestion = isShuffled
      ? host.quizService.shuffledQuestions[idx]
      : host.quizService.questions[idx];

    const hasSelectedOption = currentQuestion?.options?.some((o: Option) => o.selected) ?? false;
    const quizServiceHasSelections = host.quizService.selectedOptionsMap?.has(idx) ?? false;
    const selectedOptionServiceHasSelections = (host.selectedOptionService.selectedOptionsMap?.get(idx)?.length ?? 0) > 0;
    const hasTrackedInteraction = host.quizStateService.hasUserInteracted(idx);
    const hasAnswerEvidence =
      hasSelectedOption || quizServiceHasSelections || selectedOptionServiceHasSelections || hasTrackedInteraction;

    const selectedForIdx = (host.selectedOptionService.selectedOptionsMap?.get(idx) ?? []) as Option[];
    const isActuallyResolved = currentQuestion && host.selectedOptionService.isQuestionResolvedCorrectly(currentQuestion, selectedForIdx);

    if (isActuallyResolved && !host.isNavigatingToPrevious) {
      console.log(`[CQCC] Q${idx + 1} is already perfectly resolved. Showing explanation mode.`);
      host.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
    } else {
      console.log(`[CQCC] Q${idx + 1} is ${host.isNavigatingToPrevious ? 'navigating back' : 'not resolved'}. Forcing question mode.`);
      host.quizStateService.setDisplayState({ mode: 'question', answered: false });

      if (!hasAnswerEvidence) {
        ets.resetForIndex(idx);
        ets.latestExplanation = '';
        ets.latestExplanationIndex = idx;
        ets.formattedExplanationSubject.next('');
        ets.explanationText$.next('');

        try { (ets as any)._fetSubject?.next({ idx: -1, text: '', token: 0 }); } catch { }
        try { ets.fetByIndex?.delete(idx); } catch { }
        try { delete (ets.formattedExplanations as any)[idx]; } catch { }

        host._lastQuestionTextByIndex?.delete(idx);
        host.quizService.selectedOptionsMap?.delete(idx);
        host.selectedOptionService.selectedOptionsMap?.delete(idx);
        host._fetDisplayedThisSession?.delete(idx);
        ets.setShouldDisplayExplanation(false, { force: true });
        ets.setIsExplanationTextDisplayed(false, { force: true });
      }
    }

    host.resetExplanationView();
    if (host._showExplanation) host._showExplanation = false;

    host.cdRef.markForCheck();
  }

  runSetupQuestionResetSubscription(host: Host): void {
    if (!host.questionToDisplay$) return;
    combineLatest([
      host.questionToDisplay$.pipe(startWith(''), distinctUntilChanged()),
      host.quizService.currentQuestionIndex$.pipe(
        startWith(host.quizService?.currentQuestionIndex ?? 0)
      )
    ])
      .pipe(takeUntil(host.destroy$))
      .subscribe((pair: any) => {
        const index: number = pair[1];
        if (host.lastQuestionIndexForReset !== index) {
          host.explanationTextService.setShouldDisplayExplanation(false);
          host.lastQuestionIndexForReset = index;

          host.quizService.isAnswered(index).pipe(take(1))
            .subscribe((isAnswered: boolean) => {
              if (!isAnswered) {
                host.quizStateService.setDisplayState({ mode: 'question', answered: false });
                host.explanationTextService.setIsExplanationTextDisplayed(false, { force: true });
              }
            });
        }
      });
  }

  runSubscribeToDisplayText(host: Host): void {
    host.combinedText$ = host.displayText$;

    if (host.combinedSub) {
      host.combinedSub.unsubscribe();
    }

    console.log('[subscribeToDisplayText] 🔄 Setting up subscription...');

    host.combinedSub = host.combinedText$
      .pipe(
        tap((text: string) => console.log(`[subscribeToDisplayText] 🔔 RAW emission (${text?.length || 0} chars): "${text?.substring(0, 50)}..."`)),
        takeUntil(host.destroy$)
      )
      .subscribe({
        next: (text: string) => {
          console.log(`[subscribeToDisplayText] 📝 Processing text (${text?.length || 0} chars)`);

          let finalText = text;
          const lowerText = (text ?? '').toLowerCase();
          const currentQ = host.quizService.getQuestionsInDisplayOrder()?.[host.currentIndex];
          const qTextRaw = (currentQ?.questionText ?? '').trim();
          const isQuestionText = qTextRaw.length > 0 && (text ?? '').trim().startsWith(qTextRaw);
          const isExplanation = lowerText.length > 0
            && !isQuestionText
            && !lowerText.includes('correct because')
            && host.explanationTextService.latestExplanationIndex === host.currentIndex
            && host.explanationTextService.latestExplanationIndex >= 0;
          if (isExplanation) {
            const idx = host.currentIndex;
            const cached = (host.explanationTextService.formattedExplanations[idx]?.explanation ?? '').trim()
              || ((host.explanationTextService as any).fetByIndex?.get(idx) ?? '').trim();
            if (cached && cached.toLowerCase().includes('correct because')) {
              finalText = cached;
              console.log(`[subscribeToDisplayText] 🔧 Replaced raw with CACHED FET for Q${idx + 1}`);
            } else {
              try {
                const questions = host.quizService.getQuestionsInDisplayOrder();
                const q = questions?.[idx];
                if (q?.options?.length > 0 && q.explanation) {
                  const correctIndices = host.explanationTextService.getCorrectOptionIndices(q, q.options, idx);
                  if (correctIndices.length > 0) {
                    finalText = host.explanationTextService.formatExplanation(q, correctIndices, q.explanation);
                    console.log(`[subscribeToDisplayText] 🔧 On-the-fly FET for Q${idx + 1}: "${finalText.slice(0, 50)}"`);
                  }
                }
              } catch (e) {
                console.warn('[subscribeToDisplayText] On-the-fly FET failed', e);
              }
            }
          }

          const el = host.qText?.nativeElement;
          if (el) {
            // Guard against blanking the DOM when displayText$ momentarily
            // emits an empty string (common after tab visibility restore,
            // when combineLatest sources re-fire with stale/null values).
            const incoming = (finalText ?? '').trim();
            const cached = (host._lastDisplayedText ?? '').trim();
            if (!incoming && cached) {
              console.warn('[subscribeToDisplayText] ⚠️ Empty text after restore — keeping cached');
              host.renderer.setProperty(el, 'innerHTML', cached);
              return;
            }
            host.renderer.setProperty(el, 'innerHTML', finalText);
            host._lastDisplayedText = finalText;
            console.log(`[subscribeToDisplayText] ✅ Updated innerHTML using Renderer2: "${finalText?.substring(0, 50)}..."`);
          } else {
            console.warn(`[subscribeToDisplayText] ⚠️ qText.nativeElement not available!`);
          }
        },
        error: (err: Error) => console.error('[subscribeToDisplayText] ❌ Error:', err),
        complete: () => console.log('[subscribeToDisplayText] 🏁 Subscription completed')
      });

    console.log('[subscribeToDisplayText] ✅ Subscription active');
  }

  runSetupContentAvailability(host: Host): void {
    host.isContentAvailable$ = host.combineCurrentQuestionAndOptions().pipe(
      map(({ currentQuestion, currentOptions }: { currentQuestion: QuizQuestion | null; currentOptions: Option[] }) => {
        return !!currentQuestion && currentOptions.length > 0;
      }),
      distinctUntilChanged(),
      catchError((error: Error) => {
        console.error('Error in isContentAvailable$:', error);
        return of(false);
      }),
      startWith(false)
    );

    host.isContentAvailable$
      .pipe(distinctUntilChanged())
      .subscribe((isAvailable: boolean) => {
        if (isAvailable) {
          console.log('Content is available. Setting up state subscription.');
        } else {
          console.log('Content is not yet available.');
        }
      });
  }

  runEmitContentAvailableState(host: Host): void {
    host.isContentAvailable$.pipe(takeUntil(host.destroy$)).subscribe({
      next: (isAvailable: boolean) => {
        host.isContentAvailableChange.emit(isAvailable);
        host.quizDataService.updateContentAvailableState(isAvailable);
      },
      error: (error: Error) => console.error('Error in isContentAvailable$:', error)
    });
  }

  runLoadQuizDataFromRoute(host: Host): void {
    host.activatedRoute.paramMap.subscribe(async (params: ParamMap) => {
      const quizId = params.get('quizId');
      const questionIndex = Number(params?.get('questionIndex') ?? 1);
      const zeroBasedIndex = questionIndex - 1;

      if (quizId) {
        host.quizId = quizId;
        host.quizService.quizId = quizId;
        host.quizService.setQuizId(quizId);
        localStorage.setItem('quizId', quizId);
        host.currentQuestionIndexValue = zeroBasedIndex;

        host.questionIndexSubject.next(zeroBasedIndex);
        host.currentIndex = zeroBasedIndex;

        await host.loadQuestion(quizId, zeroBasedIndex);
      } else {
        console.error('Quiz ID is missing from route parameters');
      }
    });

    host.currentQuestion
      .pipe(
        debounceTime(200),
        tap((question: QuizQuestion | null) => {
          if (question) host.updateCorrectAnswersDisplay(question).subscribe();
        })
      )
      .subscribe();
  }

  async runLoadQuestion(host: Host, quizId: string, zeroBasedIndex: number): Promise<void> {
    if (zeroBasedIndex == null || isNaN(zeroBasedIndex)) {
      console.error('Question index is null or undefined');
      return;
    }

    try {
      const questions = (await firstValueFrom(
        host.quizDataService.getQuestionsForQuiz(quizId)
      )) as QuizQuestion[];
      if (
        questions &&
        questions.length > 0 &&
        zeroBasedIndex >= 0 &&
        zeroBasedIndex < questions.length
      ) {
        let question = questions[zeroBasedIndex];
        if (host.quizService.isShuffleEnabled() &&
          host.quizService.shuffledQuestions?.length > zeroBasedIndex) {
          question = host.quizService.shuffledQuestions[zeroBasedIndex];
          console.log(`[loadQuestion] 🔀 Using Shuffled Question for Q${zeroBasedIndex + 1}`);
        }

        host.currentQuestion.next(question);
        host.isExplanationDisplayed = false;
        host.explanationToDisplay = '';

        host.explanationTextService.resetExplanationState();
        host.explanationTextService.resetExplanationText();

        host.quizService.setCurrentQuestion(question);
      } else {
        console.error('Invalid question index:', zeroBasedIndex);
      }
    } catch (error: any) {
      console.error('Error fetching questions for quiz:', error);
    }
  }

  async runInitializeQuestionData(host: Host): Promise<void> {
    try {
      const params: ParamMap = await firstValueFrom(
        host.activatedRoute.paramMap.pipe(take(1))
      );

      const data: [QuizQuestion[], string[]] = await firstValueFrom(
        host.fetchQuestionsAndExplanationTexts(params).pipe(
          takeUntil(host.destroy$)
        )
      );

      const [questions, explanationTexts] = data;

      if (!questions || questions.length === 0) {
        console.warn('No questions found');
        return;
      }

      host.explanationTexts = explanationTexts;

      host.quizService.questions = questions;
      if (host.quizService.questions$ instanceof BehaviorSubject || host.quizService.questions$ instanceof Subject) {
        (host.quizService.questions$ as unknown as Subject<QuizQuestion[]>).next(questions);
      }

      questions.forEach((_: any, index: number) => {
        const explanation = host.explanationTexts[index] ?? 'No explanation available';
        host.explanationTextService.setExplanationTextForQuestionIndex(index, explanation);
      });

      host.explanationTextService.explanationsInitialized = true;

      host.initializeCurrentQuestionIndex();
    } catch (error: any) {
      console.error('Error in initializeQuestionData:', error);
    }
  }

  runFetchQuestionsAndExplanationTexts(host: Host, params: ParamMap): Observable<[QuizQuestion[], string[]]> {
    host.quizId = params.get('quizId') ?? '';
    if (!host.quizId) {
      console.warn('No quizId provided in the parameters.');
      return of([[], []] as [QuizQuestion[], string[]]);
    }

    return forkJoin([
      host.quizDataService.getQuestionsForQuiz(host.quizId).pipe(
        catchError((error: Error) => {
          console.error('Error fetching questions:', error);
          return of([] as QuizQuestion[]);
        })
      ),
      host.quizDataService.getAllExplanationTextsForQuiz(host.quizId).pipe(
        catchError((error: Error) => {
          console.error('Error fetching explanation texts:', error);
          return of([] as string[]);
        })
      ),
    ]).pipe(
      map((results: any) => {
        const [questions, explanationTexts] = results;
        return [questions as QuizQuestion[], explanationTexts as string[]];
      })
    );
  }

  runUpdateCorrectAnswersDisplay(host: Host, question: QuizQuestion | null): Observable<void> {
    if (!question) {
      return of(void 0);
    }

    return host.quizQuestionManagerService
      .isMultipleAnswerQuestion(question)
      .pipe(
        tap((isMultipleAnswer: boolean) => {
          const correctAnswers = question.options.filter((option) => option.correct).length;
          const explanationDisplayed = host.explanationTextService.isExplanationTextDisplayedSource.getValue();
          const newCorrectAnswersText =
            isMultipleAnswer && !explanationDisplayed
              ? host.quizQuestionManagerService.getNumberOfCorrectAnswersText(
                correctAnswers,
                question.options?.length ?? 0
              )
              : '';

          if (host.correctAnswersTextSource.getValue() !== newCorrectAnswersText) {
            host.correctAnswersTextSource.next(newCorrectAnswersText);
          }

          const shouldDisplayCorrectAnswers = isMultipleAnswer && !explanationDisplayed;
          if (host.shouldDisplayCorrectAnswersSubject.getValue() !== shouldDisplayCorrectAnswers) {
            host.shouldDisplayCorrectAnswersSubject.next(shouldDisplayCorrectAnswers);
          }
        }),
        map(() => void 0)
      );
  }

  runInitializeCombinedQuestionData(host: Host): void {
    const currentQuizAndOptions$ = host.combineCurrentQuestionAndOptions();

    currentQuizAndOptions$.pipe(takeUntil(host.destroy$)).subscribe({
      next: (data: any) => {
        console.log('Current Quiz and Options Data', data);
      },
      error: (err: any) => console.error('Error combining current quiz and options:', err)
    });

    host.combinedQuestionData$ = combineLatest([
      currentQuizAndOptions$.pipe(
        startWith<{
          currentQuestion: QuizQuestion | null;
          currentOptions: Option[];
          explanation: string;
          currentIndex: number;
        } | null>(null)
      ),
      host.numberOfCorrectAnswers$.pipe(startWith(0)),
      host.isExplanationTextDisplayed$.pipe(startWith(false)),
      host.activeFetText$.pipe(startWith(''))
    ]).pipe(
      map(
        (arr: any): CombinedQuestionDataType => {
          const quiz: { currentQuestion: QuizQuestion | null; currentOptions: Option[]; explanation: string; currentIndex: number; } | null = arr[0];
          const numberOfCorrectAnswers: number | string = arr[1];
          const isExplanationDisplayed: boolean = arr[2];
          const formattedExplanation: string = arr[3];
          const safeQuizData = quiz?.currentQuestion
            ? quiz
            : { currentQuestion: null, currentOptions: [], explanation: '', currentIndex: 0 };

          const selectionMessage =
            'selectionMessage' in safeQuizData
              ? (safeQuizData as any).selectionMessage || ''
              : '';

          const currentQuizData: CombinedQuestionDataType = {
            currentQuestion: safeQuizData.currentQuestion,
            currentOptions: safeQuizData.currentOptions ?? [],
            options: safeQuizData.currentOptions ?? [],
            questionText: safeQuizData.currentQuestion?.questionText || 'No question available',
            explanation: safeQuizData.explanation ?? '',
            correctAnswersText: '',
            isExplanationDisplayed: !!isExplanationDisplayed,
            isNavigatingToPrevious: false,
            selectionMessage
          };

          return host.calculateCombinedQuestionData(
            currentQuizData,
            +(numberOfCorrectAnswers ?? 0),
            !!isExplanationDisplayed,
            formattedExplanation ?? ''
          );
        }
      ),
      filter((data: CombinedQuestionDataType | null): data is CombinedQuestionDataType => data !== null),
      catchError((error: Error) => {
        console.error('Error combining quiz data:', error);
        const fallback: CombinedQuestionDataType = {
          currentQuestion: {
            questionText: 'Error loading question',
            options: [],
            explanation: '',
            selectedOptions: [],
            answer: [],
            selectedOptionIds: [],
            type: undefined as any,
            maxSelections: 0
          },
          currentOptions: [],
          options: [],
          questionText: 'Error loading question',
          explanation: '',
          correctAnswersText: '',
          isExplanationDisplayed: false,
          isNavigatingToPrevious: false,
          selectionMessage: ''
        };

        return of<CombinedQuestionDataType>(fallback);
      }),
    );
  }

  runCombineCurrentQuestionAndOptions(host: Host): Observable<{
    currentQuestion: QuizQuestion | null;
    currentOptions: Option[];
    explanation: string;
    currentIndex: number;
  }> {
    return host.quizService.questionPayload$.pipe(
      withLatestFrom(host.quizService.currentQuestionIndex$),
      filter(
        (value: [QuestionPayload | null, number]): value is [QuestionPayload, number] => {
          const [payload] = value;
          return (
            !!payload &&
            !!payload.question &&
            Array.isArray(payload.options) &&
            payload.options.length > 0
          );
        }
      ),
      map(([payload, index]: [QuestionPayload, number]) => ({
        payload,
        index: Number.isFinite(index)
          ? index
          : host.currentIndex >= 0
            ? host.currentIndex
            : 0
      })),
      filter(({ payload, index }: { payload: QuestionPayload; index: number }) => {
        const expected =
          Array.isArray(host.questions) && index >= 0
            ? (host.questions[index] ?? null)
            : null;

        if (!expected) return true;

        const normalizedExpected = host.normalizeKeySource(expected.questionText);
        const normalizedIncoming = host.normalizeKeySource(payload.question?.questionText);

        if (normalizedExpected && normalizedIncoming && normalizedExpected !== normalizedIncoming) {
          console.warn('[combineCurrentQuestionAndOptions] ⚠️ Mismatch detected but ALLOWING update to fix Shuffled Stuck Text.', {
            index, normalizedExpected, normalizedIncoming
          });
        }

        return true;
      }),
      map(({ payload, index }: { payload: QuestionPayload; index: number }) => {
        const normalizedOptions = payload.options
          .map((option, optionIndex) => ({
            ...option,
            optionId: typeof option.optionId === 'number' ? option.optionId : optionIndex + 1,
            displayOrder: typeof option.displayOrder === 'number' ? option.displayOrder : optionIndex
          }))
          .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

        const normalizedQuestion: QuizQuestion = {
          ...payload.question,
          options: normalizedOptions
        };

        host.currentQuestion$.next(normalizedQuestion);
        host.currentOptions$.next(normalizedOptions);

        return {
          currentQuestion: normalizedQuestion,
          currentOptions: normalizedOptions,
          explanation:
            payload.explanation?.trim() ||
            payload.question.explanation?.trim() ||
            '',
          currentIndex: index
        };
      }),
      distinctUntilChanged(
        (prev: { currentQuestion: QuizQuestion; currentOptions: Option[]; explanation: string; currentIndex: number },
          curr: { currentQuestion: QuizQuestion; currentOptions: Option[]; explanation: string; currentIndex: number }) => {
          const norm = (s?: string) =>
            (s ?? '')
              .replace(/<[^>]*>/g, ' ')
              .replace(/&nbsp;/g, ' ')
              .trim()
              .toLowerCase()
              .replace(/\s+/g, ' ');

          const questionKey = (q: QuizQuestion | null | undefined, idx?: number) => {
            const textKey = norm(q?.questionText);
            return `${textKey}#${Number.isFinite(idx) ? idx : -1}`;
          };

          const sameQuestion =
            questionKey(prev.currentQuestion, prev.currentIndex) ===
            questionKey(curr.currentQuestion, curr.currentIndex);
          if (!sameQuestion) return false;

          if (prev.explanation !== curr.explanation) return false;

          return host.haveSameOptionOrder(prev.currentOptions, curr.currentOptions);
        }),
      shareReplay({ bufferSize: 1, refCount: true }),
      catchError((error: Error) => {
        console.error('Error in combineCurrentQuestionAndOptions:', error);
        return of({
          currentQuestion: null,
          currentOptions: [],
          explanation: '',
          currentIndex: -1
        });
      })
    );
  }

  runCalculateCombinedQuestionData(
    host: Host,
    currentQuizData: CombinedQuestionDataType,
    numberOfCorrectAnswers: number,
    isExplanationDisplayed: boolean,
    formattedExplanation: string
  ): CombinedQuestionDataType {
    const { currentQuestion, currentOptions } = currentQuizData;

    if (!currentQuestion) {
      console.error('No current question found in data:', currentQuizData);
      return {
        currentQuestion: null,
        currentOptions: [],
        options: [],
        questionText: 'No question available',
        explanation: '',
        correctAnswersText: '',
        isExplanationDisplayed: false,
        isNavigatingToPrevious: false,
        selectionMessage: ''
      };
    }

    const normalizedCorrectCount = Number.isFinite(numberOfCorrectAnswers) ? numberOfCorrectAnswers : 0;

    const totalOptions = Array.isArray(currentOptions)
      ? currentOptions.length
      : Array.isArray(currentQuestion?.options)
        ? currentQuestion.options.length
        : 0;

    const isMultipleAnswerQuestion =
      currentQuestion.type === QuestionType.MultipleAnswer ||
      (Array.isArray(currentQuestion.options)
        ? currentQuestion.options.filter((option) => option.correct).length > 1
        : false);

    const correctAnswersText =
      isMultipleAnswerQuestion && normalizedCorrectCount > 0
        ? host.quizQuestionManagerService.getNumberOfCorrectAnswersText(normalizedCorrectCount, totalOptions)
        : '';

    const explanationText = isExplanationDisplayed
      ? formattedExplanation?.trim() || currentQuizData.explanation || currentQuestion.explanation || ''
      : '';

    return {
      currentQuestion: currentQuestion,
      currentOptions: currentOptions,
      options: currentOptions ?? [],
      questionText: currentQuestion.questionText,
      explanation: explanationText,
      correctAnswersText,
      isExplanationDisplayed: isExplanationDisplayed,
      isNavigatingToPrevious: false,
      selectionMessage: ''
    };
  }

  runSetupCorrectAnswersTextDisplay(host: Host): void {
    host.shouldDisplayCorrectAnswers$ = combineLatest([
      host.shouldDisplayCorrectAnswers$.pipe(
        startWith(false),
        map((value: boolean) => value ?? false),
        distinctUntilChanged()
      ),
      host.isExplanationDisplayed$.pipe(
        startWith(false),
        map((value: boolean) => value ?? false),
        distinctUntilChanged()
      ),
    ]).pipe(
      map((arr: any) => !!arr[0] && !arr[1]),
      distinctUntilChanged(),
      catchError((error: Error) => {
        console.error('Error in shouldDisplayCorrectAnswers$ observable:', error);
        return of(false);
      }),
    );

    host.displayCorrectAnswersText$ = host.shouldDisplayCorrectAnswers$.pipe(
      switchMap((shouldDisplay: boolean) => {
        return shouldDisplay ? host.correctAnswersText$ : of(null);
      }),
      distinctUntilChanged(),
      catchError((error: Error) => {
        console.error('Error in displayCorrectAnswersText$ observable:', error);
        return of(null);
      })
    );
  }

  runHaveSameOptionOrder(_host: Host, left: Option[] = [], right: Option[] = []): boolean {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;

    return left.every((option, index) => {
      const other = right[index];
      if (!other) return false;
      const optionText = (option.text ?? '').toString();
      const otherText = (other.text ?? '').toString();
      return (
        option.optionId === other.optionId &&
        option.displayOrder === other.displayOrder &&
        optionText === otherText
      );
    });
  }

  runNormalizeKeySource(_host: Host, value: string | null | undefined): string {
    return (value ?? '')
      .toString()
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }
}
