import { Injectable } from '@angular/core';

import { Option } from '../../models/Option.model';
import { OptionBindings } from '../../models/OptionBindings.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { SelectedOption } from '../../models/SelectedOption.model';
import { ExplanationTextService } from './explanation-text.service';
import { SelectionMessageService } from './selection-message.service';
import { QuizService } from '../data/quiz.service';
import { QuizStateService } from '../state/quizstate.service';
import { NextButtonStateService } from '../state/next-button-state.service';
import { SelectedOptionService } from '../state/selectedoption.service';
import { TimerService } from './timer.service';
import { SoundService } from '../ui/sound.service';
import { FeedbackConfig } from '../../../components/question/quiz-question/quiz-question.component';

/**
 * Handles timer expiry, lock, and disable logic for QQC.
 * Extracted from QuizQuestionComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QqcTimerEffectService {

  constructor(
    private explanationTextService: ExplanationTextService,
    private selectionMessageService: SelectionMessageService,
    private quizService: QuizService,
    private quizStateService: QuizStateService,
    private nextButtonStateService: NextButtonStateService,
    private selectedOptionService: SelectedOptionService,
    private timerService: TimerService,
    private soundService: SoundService
  ) {}

  /**
   * Collects canonical option snapshots and lock keys for a given question index.
   */
  collectLockContextForQuestion(
    i0: number,
    context: {
      question?: QuizQuestion | null;
      fallbackOptions?: Option[] | null;
      optionsToDisplay?: Option[];
      sharedOptionBindings?: OptionBindings[];
      currentQuestionIndex?: number;
      currentQuestion?: QuizQuestion | null;
    } = {}
  ): {
    canonicalOpts: Option[];
    lockKeys: Set<string | number>;
  } {
    const lockKeys = new Set<string | number>();

    const addKeyVariant = (raw: unknown) => {
      if (raw == null) return;

      if (typeof raw === 'number') {
        lockKeys.add(raw);
        lockKeys.add(String(raw));
        return;
      }

      const str = String(raw).trim();
      if (!str) return;

      const num = Number(str);
      if (Number.isFinite(num)) {
        lockKeys.add(num);
      }

      lockKeys.add(str);
    };

    const harvestOptionKeys = (opt?: Option, idx?: number) => {
      if (!opt) return;

      addKeyVariant(opt.optionId);
      addKeyVariant(opt.value);

      try {
        const stable = this.selectionMessageService.stableKey(opt, idx);
        addKeyVariant(stable);
      } catch { }
    };

    const resolvedQuestion =
      context.question ??
      (context.currentQuestionIndex === i0 ? context.currentQuestion : undefined);

    const baseOptions = (() => {
      if (Array.isArray(resolvedQuestion?.options) && resolvedQuestion!.options.length) {
        return resolvedQuestion!.options;
      }
      if (Array.isArray(context.fallbackOptions) && context.fallbackOptions.length) {
        return context.fallbackOptions;
      }
      if (Array.isArray(context.optionsToDisplay) && context.optionsToDisplay.length) {
        return context.optionsToDisplay;
      }
      return [] as Option[];
    })();

    let canonicalOpts: Option[] = baseOptions.map((o, idx) => {
      harvestOptionKeys(o, idx);

      const numericId = Number(o.optionId);

      return {
        ...o,
        optionId: Number.isFinite(numericId) ? numericId : o.optionId,
        selected: !!o.selected
      } as Option;
    });

    if (!canonicalOpts.length && Array.isArray(context.sharedOptionBindings)) {
      canonicalOpts = context.sharedOptionBindings
        .map((binding, idx) => {
          const opt = binding?.option;
          if (!opt) return undefined;
          harvestOptionKeys(opt, idx);
          const numericId = Number(opt.optionId);
          return {
            ...opt,
            optionId: Number.isFinite(numericId) ? numericId : opt.optionId,
            selected: !!opt.selected
          } as Option;
        })
        .filter((opt): opt is Option => !!opt);
    }

    (context.optionsToDisplay ?? []).forEach((opt, idx) => harvestOptionKeys(opt, idx));
    (context.sharedOptionBindings ?? []).forEach((binding, idx) =>
      harvestOptionKeys(binding?.option, idx)
    );

    return { canonicalOpts, lockKeys };
  }

  /**
   * Applies lock and disable states for a question's options after timer stop/timeout.
   */
  applyLocksAndDisableForQuestion(
    i0: number,
    canonicalOpts: Option[],
    lockKeys: Set<string | number>,
    opts: { revealFeedback: boolean },
    callbacks: {
      revealFeedbackForAllOptions: (opts: Option[]) => void;
      forceDisableSharedOption: () => void;
      updateBindingsAndOptions: (lockDisable: boolean) => {
        optionBindings: OptionBindings[];
        optionsToDisplay: Option[];
      };
    }
  ): void {
    if (opts.revealFeedback) {
      try { callbacks.revealFeedbackForAllOptions(canonicalOpts); } catch { }
    }

    try { this.selectedOptionService.lockQuestion(i0); } catch { }

    if (lockKeys.size) {
      try {
        this.selectedOptionService.lockMany(i0, Array.from(lockKeys));
      } catch { }
    }

    try {
      callbacks.forceDisableSharedOption();
    } catch { }

    try {
      callbacks.updateBindingsAndOptions(true);
    } catch { }
  }

  /**
   * Handles the question timeout event: reveals feedback, shows explanation, enables next.
   */
  onQuestionTimedOut(params: {
    targetIndex?: number;
    currentQuestionIndex: number;
    questions: QuizQuestion[];
    currentQuestion: QuizQuestion | null;
    optionsToDisplay: Option[];
    sharedOptionBindings?: OptionBindings[];
    totalQuestions: number;
    formattedByIndex: Map<number, string>;
    lastAllCorrect: boolean;
    normalizeIndex: (idx: number) => number;
    setExplanationFor: (idx: number, html: string) => void;
    resolveFormatted: (idx: number) => Promise<string>;
    revealFeedbackForAllOptions: (opts: Option[]) => void;
    forceDisableSharedOption: () => void;
    updateBindingsAndOptions: (lockDisable: boolean) => {
      optionBindings: OptionBindings[];
      optionsToDisplay: Option[];
    };
    markForCheck: () => void;
  }): {
    explanationToDisplay: string;
    timedOut: boolean;
    timerStoppedForQuestion: boolean;
  } {
    const activeIndex = params.targetIndex ?? params.currentQuestionIndex ?? 0;
    const i0 = params.normalizeIndex(activeIndex);
    const q =
      params.questions?.[i0] ??
      (params.currentQuestionIndex === i0 ? params.currentQuestion : undefined);

    // Collect canonical snapshot and robust lock keys
    const { canonicalOpts, lockKeys } = this.collectLockContextForQuestion(i0, {
      question: q,
      fallbackOptions: params.optionsToDisplay,
      optionsToDisplay: params.optionsToDisplay,
      sharedOptionBindings: params.sharedOptionBindings,
      currentQuestionIndex: params.currentQuestionIndex,
      currentQuestion: params.currentQuestion,
    });

    // Reveal feedback, lock, and disable options
    this.applyLocksAndDisableForQuestion(i0, canonicalOpts, lockKeys, {
      revealFeedback: true
    }, {
      revealFeedbackForAllOptions: params.revealFeedbackForAllOptions,
      forceDisableSharedOption: params.forceDisableSharedOption,
      updateBindingsAndOptions: params.updateBindingsAndOptions,
    });

    // Announce completion to listeners
    try {
      this.selectionMessageService.releaseBaseline(activeIndex);
      this.selectionMessageService.setOptionsSnapshot(canonicalOpts);

      const anySelected = canonicalOpts.some(opt => !!opt?.selected);
      if (!anySelected) {
        const total = params.totalQuestions ?? this.quizService?.totalQuestions ?? 0;
        const isLastQuestion = total > 0 && i0 === total - 1;
        this.selectionMessageService.forceNextButtonMessage(i0, {
          isLastQuestion
        });
      } else {
        this.selectionMessageService.setSelectionMessage(params.lastAllCorrect);
      }
    } catch { }

    // Show explanation regardless of correctness
    let explanationToDisplay = '';
    try {
      this.explanationTextService.setShouldDisplayExplanation(true);

      const cached = params.formattedByIndex.get(i0)
        ?? this.explanationTextService.fetByIndex?.get(i0)
        ?? this.explanationTextService.formattedExplanations?.[i0]?.explanation
        ?? '';
      const rawTrue =
        (q?.explanation ?? params.currentQuestion?.explanation ?? '').trim();
      const hasFet = cached && cached.toLowerCase().includes('correct because');
      const immediateTxt = (hasFet ? cached.trim() : '') || rawTrue || '<span class="muted">Formatting…</span>';
      params.setExplanationFor(i0, immediateTxt);
      explanationToDisplay = immediateTxt;

      // Emit FET to the service
      if (hasFet) {
        this.explanationTextService.setExplanationText(immediateTxt, { index: i0 });
      }

      // If no cached FET, resolve asynchronously
      if (!hasFet) {
        params.resolveFormatted(i0).then(formatted => {
          if (formatted) {
            params.setExplanationFor(i0, formatted);
            this.explanationTextService.setExplanationText(formatted, { index: i0 });
            params.markForCheck();
          }
        }).catch(() => {});
      }
    } catch { }

    // Allow navigation to proceed
    this.nextButtonStateService.setNextButtonState(true);
    this.quizStateService.setAnswered(true);
    this.quizStateService.setAnswerSelected(true);

    // Defensive stop
    try { this.timerService.stopTimer(undefined, { force: true }); } catch { }

    params.markForCheck();

    return {
      explanationToDisplay,
      timedOut: true,
      timerStoppedForQuestion: true,
    };
  }

  /**
   * Handles when the timer stops for the active question (non-timeout case).
   */
  handleTimerStoppedForActiveQuestion(params: {
    reason: 'timeout' | 'stopped';
    timerStoppedForQuestion: boolean;
    currentQuestionIndex: number;
    questions: QuizQuestion[];
    questionFresh: boolean;
    optionsToDisplay: Option[];
    sharedOptionBindings?: OptionBindings[];
    currentQuestion: QuizQuestion | null;
    normalizeIndex: (idx: number) => number;
    revealFeedbackForAllOptions: (opts: Option[]) => void;
    forceDisableSharedOption: () => void;
    updateBindingsAndOptions: (lockDisable: boolean) => {
      optionBindings: OptionBindings[];
      optionsToDisplay: Option[];
    };
    markForCheck: () => void;
    detectChanges: () => void;
  }): boolean {
    if (params.timerStoppedForQuestion) return true;

    const i0 = params.normalizeIndex(params.currentQuestionIndex ?? 0);
    if (!Number.isFinite(i0) || !params.questions?.[i0]) return false;
    if (params.reason !== 'timeout' && params.questionFresh) return false;

    const { canonicalOpts, lockKeys } = this.collectLockContextForQuestion(i0, {
      optionsToDisplay: params.optionsToDisplay,
      sharedOptionBindings: params.sharedOptionBindings,
      currentQuestionIndex: params.currentQuestionIndex,
      currentQuestion: params.currentQuestion,
    });

    this.applyLocksAndDisableForQuestion(i0, canonicalOpts, lockKeys, {
      revealFeedback: params.reason === 'timeout'
    }, {
      revealFeedbackForAllOptions: params.revealFeedbackForAllOptions,
      forceDisableSharedOption: params.forceDisableSharedOption,
      updateBindingsAndOptions: params.updateBindingsAndOptions,
    });

    if (params.reason !== 'timeout') {
      try {
        this.selectionMessageService.releaseBaseline(params.currentQuestionIndex);
      } catch { }
    }

    params.markForCheck();
    params.detectChanges();

    return true; // timerStoppedForQuestion = true
  }

  /**
   * Stops the timer if all correct answers are selected.
   */
  stopTimerIfAllCorrectSelected(params: {
    currentQuestionIndex: number;
    questions: QuizQuestion[];
    optionsToDisplay: Option[];
  }): void {
    const idx = this.quizService.getCurrentQuestionIndex();

    // Canonical (truth for `correct`)
    const canonical = (this.quizService.questions?.[idx]?.options ?? []).map((o: Option) => ({ ...o }));
    // UI (truth for `selected`, possibly a different array)
    const ui = (params.optionsToDisplay ?? []).map((o: Option) => ({ ...o }));

    // Overlay UI.selected → canonical by identity
    const snapshot = this.selectedOptionService.overlaySelectedByIdentity(canonical, ui);

    // Defer one macrotask so any async CD/pipes settle
    setTimeout(() => {
      const totalCorrect = snapshot.filter(o => !!(o as any).correct).length;
      const selectedCorrect = snapshot.filter(o => !!(o as any).correct && !!(o as any).selected).length;

      if (totalCorrect > 0 && selectedCorrect === totalCorrect) {
        try { this.soundService?.play('correct'); } catch { }

        this.timerService.attemptStopTimerForQuestion({
          questionIndex: idx,
          optionsSnapshot: snapshot,
          onStop: (elapsed) => {
            (this.timerService as any).elapsedTimes ||= [];
            (this.timerService as any).elapsedTimes[idx] = elapsed ?? 0;
          },
        });
      }
    }, 0);
  }

  /**
   * Centralized, reasoned stop. Only stops when allowed.
   */
  safeStopTimer(
    reason: 'completed' | 'timeout' | 'navigate',
    timerStoppedForQuestion: boolean,
    lastAllCorrect: boolean
  ): boolean {
    if (timerStoppedForQuestion) return true;

    // Only "completed" may stop due to correctness
    if (reason === 'completed' && !lastAllCorrect) return false;

    try { this.timerService.stopTimer?.(undefined, { force: true }); } catch { }
    return true; // timerStoppedForQuestion = true
  }
}
