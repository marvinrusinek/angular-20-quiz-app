import { Injectable } from '@angular/core';

import { Option } from '../../models/Option.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { SelectedOption } from '../../models/SelectedOption.model';
import { QuizService } from '../data/quiz.service';
import { SelectedOptionService } from '../state/selectedoption.service';
import { QuizDotStatusService } from './quiz-dot-status.service';
import { QuizPersistenceService } from '../state/quiz-persistence.service';
import { QuizScoringService } from './quiz-scoring.service';

/**
 * Result of evaluating immediate correctness for an option click.
 */
export interface ImmediateCorrectnessResult {
  liveCorrectness: boolean | null;
  usedExplicitPayloadCorrectness: boolean;
  canPersistOptimisticStatus: boolean;
  isSingleAnswerQuestion: boolean;
  correctCountForQuestion: number;
  immediateSelections: SelectedOption[];
  questionForSelection: QuizQuestion | null;
  optionsForImmediateScoring: Option[];
  correctOptionsForQuestion: Option[];
}

/**
 * Result of single-answer scoring evaluation.
 */
export interface SingleAnswerResult {
  clickedIsCorrect: boolean;
  dotStatus: 'correct' | 'wrong';
}

/**
 * Result of multi-answer evaluation.
 */
export interface MultiAnswerResult {
  allCorrectSelected: boolean;
  hasIncorrectSelection: boolean;
  hasAnyCorrectSelection: boolean;
  immediateMultiDotStatus: 'correct' | 'wrong' | null;
  currentSelections: SelectedOption[];
  syncIds: any[];
}

/**
 * Combined result of full option evaluation.
 */
export interface OptionEvaluationResult {
  immediate: ImmediateCorrectnessResult;
  singleAnswer: SingleAnswerResult | null;
  multiAnswer: MultiAnswerResult | null;
}

/**
 * Handles the heavy evaluation and scoring logic from onOptionSelected.
 * Extracted from QuizComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QuizOptionProcessingService {

  constructor(
    private quizService: QuizService,
    private selectedOptionService: SelectedOptionService,
    private dotStatusService: QuizDotStatusService,
    private quizPersistence: QuizPersistenceService,
    private quizScoringService: QuizScoringService
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // EVALUATE IMMEDIATE CORRECTNESS
  // ═══════════════════════════════════════════════════════════════

  evaluateImmediateCorrectness(params: {
    option: SelectedOption;
    idx: number;
    liveSelections: SelectedOption[];
    questionsArray: QuizQuestion[];
    currentQuestion: QuizQuestion | null;
    optionsToDisplay: Option[];
    quizId: string;
    currentQuestionIndex: number;
  }): ImmediateCorrectnessResult {
    const { option, idx, liveSelections, questionsArray, currentQuestion, optionsToDisplay, quizId, currentQuestionIndex } = params;

    const questionForSelection =
      questionsArray?.[idx] ||
      this.quizService.questions?.[idx] ||
      this.quizService.activeQuiz?.questions?.[idx] ||
      null;

    const optionsForImmediateScoring: Option[] =
      (questionForSelection?.options as Option[]) ||
      (currentQuestion?.options as Option[]) ||
      (optionsToDisplay as Option[]) ||
      [];

    const correctOptionsForQuestion = this.dotStatusService.getResolvedCorrectOptions(
      questionForSelection as QuizQuestion | null | undefined,
      optionsForImmediateScoring
    );

    const correctCountForQuestion = correctOptionsForQuestion.length;
    const isSingleAnswerQuestion = correctCountForQuestion === 1;

    const immediateSelections = this.quizScoringService.buildImmediateSelectionsForScoring(
      idx,
      liveSelections,
      option,
      isSingleAnswerQuestion
    );

    let liveCorrectness = this.dotStatusService.evaluateSelectionCorrectness({
      index: idx,
      selections: immediateSelections,
      currentQuestionIndex,
      optionsToDisplay,
      currentQuestion,
      questionsArray,
    });

    let usedExplicitPayloadCorrectness = false;
    const hasExplicitCorrectFlag = option?.correct !== undefined && option?.correct !== null;

    if (hasExplicitCorrectFlag) {
      const payloadCorrect = option?.correct === true || String(option?.correct) === 'true';
      if (isSingleAnswerQuestion) {
        liveCorrectness = payloadCorrect;
        usedExplicitPayloadCorrectness = true;
      } else if (payloadCorrect) {
        liveCorrectness = true;
        usedExplicitPayloadCorrectness = true;
      } else if (liveCorrectness !== true && liveCorrectness !== false) {
        liveCorrectness = false;
        usedExplicitPayloadCorrectness = true;
      }
    }

    const canPersistOptimisticStatus =
      isSingleAnswerQuestion && liveCorrectness === true;

    return {
      liveCorrectness,
      usedExplicitPayloadCorrectness,
      canPersistOptimisticStatus,
      isSingleAnswerQuestion,
      correctCountForQuestion,
      immediateSelections,
      questionForSelection,
      optionsForImmediateScoring,
      correctOptionsForQuestion,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // EVALUATE SINGLE-ANSWER SCORING
  // ═══════════════════════════════════════════════════════════════

  evaluateSingleAnswer(params: {
    option: SelectedOption;
    idx: number;
    optionsForImmediateScoring: Option[];
    liveCorrectness: boolean | null;
    quizId: string;
    pendingDotStatusOverrides: Map<number, 'correct' | 'wrong'>;
    dotStatusCache: Map<number, 'correct' | 'wrong' | 'pending'>;
  }): SingleAnswerResult {
    const { option, idx, optionsForImmediateScoring, liveCorrectness, quizId } = params;

    const normalize = (value: unknown): string => String(value ?? '').trim().toLowerCase();
    const clickedOptionId = String(option?.optionId ?? '').trim();
    const clickedText = normalize(option?.text);
    const payloadSaysCorrect = option?.correct === true || String(option?.correct) === 'true';

    const sourceOptions: Option[] = optionsForImmediateScoring;

    const matchedCorrectOption = sourceOptions.some((opt: Option) => {
      const optId = String(opt?.optionId ?? '').trim();
      const optText = normalize(opt?.text);
      const isCorrect = opt?.correct === true || String(opt?.correct) === 'true';

      const idMatch = clickedOptionId !== '' && optId !== '' && clickedOptionId === optId;
      const textMatch = clickedText !== '' && optText !== '' && clickedText === optText;
      return isCorrect && (idMatch || textMatch);
    });

    const payloadIndex = Number((option as any)?.displayIndex ?? (option as any)?.index ?? -1);
    const indexMatchedCorrect =
      Number.isInteger(payloadIndex) && payloadIndex >= 0 && payloadIndex < sourceOptions.length
        ? (sourceOptions[payloadIndex]?.correct === true || String(sourceOptions[payloadIndex]?.correct) === 'true')
        : false;

    const clickedIsCorrect = payloadSaysCorrect || matchedCorrectOption || indexMatchedCorrect || liveCorrectness === true;

    if (clickedIsCorrect) {
      this.quizPersistence.setPersistedDotStatus(quizId, idx, 'correct');
      params.pendingDotStatusOverrides.set(idx, 'correct');
      params.dotStatusCache.set(idx, 'correct');
      this.selectedOptionService.clickConfirmedDotStatus.set(idx, 'correct');
      try { sessionStorage.setItem('dot_confirmed_' + idx, 'correct'); } catch {}
      this.quizService.scoreDirectly(idx, true, false);
    } else {
      this.selectedOptionService.clickConfirmedDotStatus.set(idx, 'wrong');
      try { sessionStorage.setItem('dot_confirmed_' + idx, 'wrong'); } catch {}
    }

    return {
      clickedIsCorrect,
      dotStatus: clickedIsCorrect ? 'correct' : 'wrong',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // EVALUATE MULTI-ANSWER SCORING
  // ═══════════════════════════════════════════════════════════════

  evaluateMultiAnswer(params: {
    option: SelectedOption;
    idx: number;
    immediateSelections: SelectedOption[];
    questionForSelection: QuizQuestion | null;
    optionsForImmediateScoring: Option[];
    correctOptionsForQuestion: Option[];
    quizId: string;
    pendingDotStatusOverrides: Map<number, 'correct' | 'wrong'>;
    dotStatusCache: Map<number, 'correct' | 'wrong' | 'pending'>;
    activeDotClickStatus: Map<number, 'correct' | 'wrong'>;
  }): MultiAnswerResult {
    const {
      option, idx, immediateSelections, questionForSelection,
      optionsForImmediateScoring, correctOptionsForQuestion, quizId,
    } = params;

    let allCorrectSelected = false;
    let hasAnyCorrectSelection = false;
    let hasIncorrectSelection = false;
    let immediateMultiDotStatus: 'correct' | 'wrong' | null = null;
    let currentSelections: SelectedOption[] = [...immediateSelections];
    let syncIds: any[] = [];

    const correctOpts = correctOptionsForQuestion;

    if (correctOpts.length > 1) {
      const clickedIndex = Number((option as any)?.displayIndex ?? (option as any)?.index ?? -1);
      const optionIsCurrentlySelected =
        option?.selected === true ||
        (option as any)?.checked === true ||
        (option as any)?.isSelected === true;
      const alreadyIncluded = currentSelections.some((selection) =>
        this.dotStatusService.selectionMatchesOption(selection, option, clickedIndex)
      );
      if (optionIsCurrentlySelected && !alreadyIncluded && option) {
        currentSelections.push(option as SelectedOption);
      }

      const correctOptionEntries = this.dotStatusService.getResolvedCorrectOptionEntries(questionForSelection, optionsForImmediateScoring);
      const everyCorrectSelected = correctOptionEntries.every(({ option: correctOpt, index: correctOptIndex }) => {
        return currentSelections.some((selection) =>
          this.dotStatusService.selectionMatchesOption(selection, correctOpt, correctOptIndex)
        );
      });

      allCorrectSelected = everyCorrectSelected;

      hasIncorrectSelection = currentSelections.some((selection) =>
        !this.dotStatusService.matchesAnyCorrectOption(selection, questionForSelection, optionsForImmediateScoring)
      );

      hasAnyCorrectSelection =
        currentSelections.some((selection) =>
          this.dotStatusService.matchesAnyCorrectOption(selection, questionForSelection, optionsForImmediateScoring)
        ) && !hasIncorrectSelection;

      syncIds = currentSelections
        .map((s: any) => s?.optionId)
        .filter((id: any) => id !== undefined && id !== null);
      this.quizService.updateUserAnswer(idx, syncIds);
    }

    if (allCorrectSelected) {
      this.quizService.scoreDirectly(idx, true, true);
    }

    // Compute immediate multi dot status
    const clickedIndex = Number((option as any)?.displayIndex ?? (option as any)?.index ?? -1);
    const clickedPayloadSaysCorrect =
      option?.correct === true || String(option?.correct) === 'true';
    const clickedOptionIsCorrect =
      clickedPayloadSaysCorrect ||
      this.dotStatusService.matchesAnyCorrectOption(option as SelectedOption, questionForSelection, optionsForImmediateScoring) || (
        Number.isInteger(clickedIndex) &&
        clickedIndex >= 0 &&
        clickedIndex < optionsForImmediateScoring.length &&
        (optionsForImmediateScoring[clickedIndex]?.correct === true ||
          String(optionsForImmediateScoring[clickedIndex]?.correct) === 'true')
      );

    const explicitSelectedState =
      option?.selected ??
      (option as any)?.checked ??
      (option as any)?.isSelected;
    const clickedOptionIsStillSelected = currentSelections.some((selection) =>
      this.dotStatusService.selectionMatchesOption(selection, option as SelectedOption, clickedIndex)
    );
    const clickedOptionWasDeselected =
      explicitSelectedState === false ? true : !clickedOptionIsStillSelected;

    if (allCorrectSelected && !hasIncorrectSelection) {
      immediateMultiDotStatus = 'correct';
    } else if (clickedOptionWasDeselected) {
      if (clickedOptionIsCorrect || hasIncorrectSelection) {
        immediateMultiDotStatus = 'wrong';
      } else if (hasAnyCorrectSelection) {
        immediateMultiDotStatus = 'correct';
      }
    } else if (clickedOptionIsCorrect) {
      immediateMultiDotStatus = 'correct';
    } else if (hasIncorrectSelection || hasAnyCorrectSelection) {
      immediateMultiDotStatus = 'wrong';
    }

    if (!allCorrectSelected) {
      this.quizService.scoreDirectly(idx, false, true);
    }

    if (immediateMultiDotStatus) {
      params.activeDotClickStatus.set(idx, immediateMultiDotStatus);
      this.quizPersistence.setPersistedDotStatus(quizId, idx, immediateMultiDotStatus);
      params.pendingDotStatusOverrides.set(idx, immediateMultiDotStatus);
      params.dotStatusCache.set(idx, immediateMultiDotStatus);
      this.selectedOptionService.clickConfirmedDotStatus.set(idx, immediateMultiDotStatus);
    }

    return {
      allCorrectSelected,
      hasIncorrectSelection,
      hasAnyCorrectSelection,
      immediateMultiDotStatus,
      currentSelections,
      syncIds,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // HANDLE AUTHORITATIVE CORRECTNESS CHECK
  // ═══════════════════════════════════════════════════════════════

  async handleAuthoritativeCheck(params: {
    idx: number;
    isSingleAnswerQuestion: boolean;
    immediateMultiDotStatus: 'correct' | 'wrong' | null;
    quizId: string;
  }): Promise<void> {
    const { idx, isSingleAnswerQuestion, immediateMultiDotStatus, quizId } = params;

    const authoritativeCorrectness = await this.quizService.checkIfAnsweredCorrectly(idx, false);

    if (authoritativeCorrectness === true) {
      this.quizService.scoreDirectly(idx, true, !isSingleAnswerQuestion);
      this.quizPersistence.setPersistedDotStatus(quizId, idx, 'correct');
    } else if (!isSingleAnswerQuestion && immediateMultiDotStatus) {
      this.quizPersistence.setPersistedDotStatus(quizId, idx, immediateMultiDotStatus);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PERSIST OPTION SELECTION TO SESSION
  // ═══════════════════════════════════════════════════════════════

  persistOptionSelection(params: {
    idx: number;
    quizId: string;
    explanationToDisplay: string;
    pendingDotStatusOverrides: Map<number, 'correct' | 'wrong'>;
    activeDotClickStatus: Map<number, 'correct' | 'wrong'>;
    dotStatusCache: Map<number, 'correct' | 'wrong' | 'pending'>;
    option: SelectedOption;
  }): void {
    const { idx, quizId, explanationToDisplay } = params;

    // Update QuizStateService QuestionState
    const prev = (this.quizService as any).quizStateService?.getQuestionState?.(quizId, idx);
    // Note: QuizStateService update is handled by the component since it needs the service reference

    // Persist to session
    try {
      sessionStorage.setItem('isAnswered', 'true');
      const currentIndices = this.selectedOptionService.getSelectedOptionIndices(idx);
      sessionStorage.setItem(`quiz_selection_${idx}`, JSON.stringify(currentIndices));
      sessionStorage.setItem(`displayMode_${idx}`, 'explanation');
    } catch (e) {
      console.warn('[onOptionSelected] Storage failed', e);
    }

    // Ensure sessionStorage has a dot_confirmed_ entry
    try {
      if (sessionStorage.getItem('dot_confirmed_' + idx) === null) {
        const finalDotStatus = params.pendingDotStatusOverrides.get(idx)
          ?? params.activeDotClickStatus.get(idx)
          ?? params.dotStatusCache.get(idx);
        if (finalDotStatus === 'correct' || finalDotStatus === 'wrong') {
          sessionStorage.setItem('dot_confirmed_' + idx, finalDotStatus);
        } else {
          const clickedCorrect = params.option?.correct === true || String(params.option?.correct) === 'true';
          sessionStorage.setItem('dot_confirmed_' + idx, clickedCorrect ? 'correct' : 'wrong');
        }
      }
    } catch {}
  }
}
