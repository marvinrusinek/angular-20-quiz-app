import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { distinctUntilChanged, map, startWith } from 'rxjs/operators';

import { QuestionType } from '../../shared/models/question-type.enum';
import { Option } from '../../shared/models/Option.model';
import { QuizQuestion } from '../../shared/models/QuizQuestion.model';
import { SelectedOption } from '../../shared/models/SelectedOption.model';
import { NextButtonStateService } from '../../shared/services/next-button-state.service';
import { QuizService } from '../../shared/services/quiz.service';

@Injectable({ providedIn: 'root' })
export class SelectedOptionService {
  selectedOption: SelectedOption[] = [];
  selectedOptionsMap = new Map<number, SelectedOption[]>();
  selectedOptionIndices: { [key: number]: number[] } = {};

  selectedOptionSubject = new BehaviorSubject<SelectedOption[]>([]);
  selectedOption$ = this.selectedOptionSubject.asObservable();

  private selectedOptionExplanationSource = new BehaviorSubject<string>('');
  selectedOptionExplanation$ =
    this.selectedOptionExplanationSource.asObservable();

  private isOptionSelectedSubject = new BehaviorSubject<boolean>(false);

  isAnsweredSubject = new BehaviorSubject<boolean>(false);
  isAnswered$: Observable<boolean> = this.isAnsweredSubject.asObservable();
  public answered$ = this.isAnswered$;

  private _questionCache = new Map<number, QuizQuestion>();

  private questionTextSubject = new BehaviorSubject<string>('');
  questionText$ = this.questionTextSubject.asObservable();

  private showFeedbackForOptionSubject = new BehaviorSubject<
    Record<string, boolean>
  >({});
  showFeedbackForOption$ = this.showFeedbackForOptionSubject.asObservable();
  private feedbackByQuestion = new Map<number, Record<string, boolean>>();
  private optionSnapshotByQuestion = new Map<number, Option[]>();

  private isNextButtonEnabledSubject = new BehaviorSubject<boolean>(false);

  stopTimer$ = new Subject<void>();
  stopTimerEmitted = false;

  currentQuestionType: QuestionType | null = null;
  private _lockedByQuestion = new Map<number, Set<string | number>>();
  private _questionLocks = new Set<number>();

  public _lockedOptionsMap: Map<number, Set<number>> = new Map();
  public optionStates: Map<number, any> = new Map();

  set isNextButtonEnabled(value: boolean) {
    this.isNextButtonEnabledSubject.next(value);
  }

  get isNextButtonEnabled$(): Observable<boolean> {
    return this.isNextButtonEnabledSubject.asObservable();
  }

  constructor(
    private quizService: QuizService,
    private nextButtonStateService: NextButtonStateService,
  ) {
    console.log(
      '[SelectedOptionService] 🧭 Constructed at',
      performance.now().toFixed(1),
    );

    const index$ = this.quizService?.currentQuestionIndex$;
    if (index$) {
      index$.pipe(distinctUntilChanged()).subscribe((index) => {
        this.stopTimerEmitted = false;
        this.publishFeedbackForQuestion(index);
      });
    }
  }

  isSelectedOption(option: Option): boolean {
    return (
      this.selectedOption?.some((sel) => sel.optionId === option.optionId) ??
      false
    );
  }

  deselectOption(): void {
    this.selectedOptionSubject.next([]);
    this.isOptionSelectedSubject.next(false);
  }

  // Adds an option to the selectedOptionsMap
  addOption(questionIndex: number, option: SelectedOption): void {
    if (!option) {
      console.error('Option is undefined. Cannot add it to selectedOptionsMap.');
      return;
    }

    if (option.optionId == null) {
      console.error('option.optionId is undefined:', option);
      return;
    }

    // Get existing selections for this question
    const existing = this.selectedOptionsMap.get(questionIndex) ?? [];

    // Canonicalize existing options
    const existingCanonical = this.canonicalizeSelectionsForQuestion(
      questionIndex,
      existing,
    );

    // Canonicalize the incoming option
    const newCanonical = this.canonicalizeOptionForQuestion(questionIndex, {
      ...option,
      selected: option.selected ?? true, // respect unchecked if ever passed
      highlight: true,
      showIcon: true,
    });

    if (newCanonical.optionId == null) {
      console.error('[SOS] canonical option missing ID:', newCanonical);
      return;
    }

    // ─────────────────────────────────────────────
    // ✅ AUTHORITATIVE MERGE (REPLACE BY optionId)
    // - Single-answer: newest selection replaces all previous
    // - Multi-answer: newest selection replaces same optionId
    // ─────────────────────────────────────────────
    const merged = new Map<number, SelectedOption>();

    // Keep existing selections (as a base)
    for (const o of existingCanonical) {
      if (typeof o.optionId === 'number') {
        merged.set(o.optionId, o);
      }
    }

    // If question is single-answer, replace entire selection set
    // (this prevents "first click wins" bugs)
    /* if (this.currentQuestionType === QuestionType.SingleAnswer) {
      merged.clear();
    } */

    // Apply new selection (replace by optionId)
    if (typeof newCanonical.optionId === 'number') {
      if (newCanonical.selected === false) {
        merged.delete(newCanonical.optionId); // support unselect if needed
      } else {
        merged.set(newCanonical.optionId, newCanonical);
      }
    }

    // Commit selections and store the result
    // IMPORTANT: commitSelections must NOT be allowed to drop the latest click.
    // So we give it the already-merged, latest-truth list.
    const mergedList = Array.from(merged.values());
    const committed = mergedList;
    this.selectedOptionsMap.set(questionIndex, committed);

    // Emit observable updates
    this.selectedOption = committed;
    this.selectedOptionSubject.next(committed);
    this.isOptionSelectedSubject.next(committed.length > 0);

    console.log('[SOS] addOption → final stored selection:', {
      qIndex: questionIndex,
      stored: committed.map((o) => o.optionId),
    });
  }

  // Removes an option from the selectedOptionsMap
  removeOption(questionIndex: number, optionId: number): void {
    const canonicalId = this.resolveCanonicalOptionId(questionIndex, optionId);
    if (canonicalId == null) {
      console.warn('[removeOption] Unable to resolve canonical optionId', {
        optionId,
        questionIndex,
      });
      return;
    }

    const currentOptions = this.canonicalizeSelectionsForQuestion(
      questionIndex,
      this.selectedOptionsMap.get(questionIndex) || [],
    );
    const updatedOptions = currentOptions.filter(
      (o) => o.optionId !== canonicalId,
    );

    if (updatedOptions.length > 0) {
      this.commitSelections(questionIndex, updatedOptions);
    } else {
      this.selectedOptionsMap.delete(questionIndex);
    }
  }

  setNextButtonEnabled(enabled: boolean): void {
    this.isNextButtonEnabledSubject.next(enabled); // update the button's enabled state
  }

  clearSelection(): void {
    this.isOptionSelectedSubject.next(false); // no option selected
  }

  clearOtherSelections(questionIndex: number, keepOptionId: number): void {
    const current = this.selectedOptionsMap.get(questionIndex) || [];
    this.selectedOptionsMap.set(
      questionIndex,
      current.filter(o => o.optionId === keepOptionId)
    );
  }

  public clearAllSelectionsForQuestion(questionIndex: number): void {
    const idx = this.normalizeQuestionIndex(questionIndex);
    if (idx < 0) return;

    // ─────────────────────────────────────────────
    // Canonical selection state
    // ─────────────────────────────────────────────
    this.selectedOptionsMap.set(idx, []);
    this.selectedOptionIndices[idx] = [];

    // ─────────────────────────────────────────────
    // Snapshot used by correctness logic
    // ─────────────────────────────────────────────
    this.optionSnapshotByQuestion.delete(idx);

    // ─────────────────────────────────────────────
    // Timer / correctness flags
    // ─────────────────────────────────────────────
    this.stopTimerEmitted = false;

    // ─────────────────────────────────────────────
    // Emit clean state so UI updates
    // ─────────────────────────────────────────────
    try {
      this.selectedOptionSubject.next([]);
    } catch { }

    try {
      this.isOptionSelectedSubject.next(false);
    } catch { }

    console.log('[SelectedOptionService] 🧹 Cleared all selections for Q', idx);
  }

  setSelectedOption(
    option: SelectedOption | null,
    questionIndex?: number,
    optionsSnapshot?: Option[],
    isMultipleAnswer?: boolean,
  ): void {
    console.log('[🟢 setSelectedOption called]', {
      optionId: option?.optionId,
      questionIndex: option?.questionIndex,
    });

    if (!option) {
      if (questionIndex == null) {
        console.warn(
          '[setSelectedOption] null option with no questionIndex — ignoring',
        );
        return;
      }

      console.log(
        `[setSelectedOption] Clearing selections for Q${questionIndex}`,
      );
      this.selectedOptionsMap.delete(questionIndex);
      this.selectedOptionSubject.next([]);
      this.isOptionSelectedSubject.next(false);
      this.updateAnsweredState();
      return;
    }

    const qIndex = questionIndex ?? option.questionIndex;
    if (qIndex == null) {
      console.error('[setSelectedOption] Missing questionIndex', {
        option,
        questionIndex,
      });
      return;
    }

    // Populate snapshot if provided
    if (optionsSnapshot && optionsSnapshot.length > 0) {
      console.log(
        `[setSelectedOption] 📸 Setting snapshot for Q${questionIndex} with ${optionsSnapshot.length} options.`,
      );
      this.optionSnapshotByQuestion.set(qIndex, optionsSnapshot);
    } else {
      console.log(
        `[setSelectedOption] ⚠️ No snapshot provided for Q${questionIndex}.`,
      );
    }

    const enriched: SelectedOption = this.canonicalizeOptionForQuestion(
      qIndex,
      {
        ...option,
        questionIndex: qIndex,
        selected: true,
        highlight: true,
        showIcon: true,
      },
    );

    // HARD RULE: single-answer questions may NEVER accumulate selections
    if (isMultipleAnswer === false) {
      console.warn(
        '[LOCKDOWN] Clearing previous selections for single-answer question',
        qIndex,
      );
      this.selectedOptionsMap.set(qIndex, []);
    }

    const current = this.selectedOptionsMap.get(qIndex) || [];
    let canonicalCurrent = this.canonicalizeSelectionsForQuestion(
      qIndex,
      current,
    );

    // If single answer, clear previous selections
    if (isMultipleAnswer === false) {
      canonicalCurrent = [];
    }

    const exists = canonicalCurrent.find(
      (sel) => sel.optionId === enriched.optionId,
    );

    if (isMultipleAnswer) {
      if (exists) {
        // toggle OFF
        canonicalCurrent = canonicalCurrent.filter(
          (sel) => sel.optionId !== enriched.optionId,
        );
      } else {
        // toggle ON
        canonicalCurrent.push(enriched);
      }
    } else {
      // single answer
      canonicalCurrent = [enriched];
    }

    const committed = this.commitSelections(qIndex, canonicalCurrent);

    // Synchronously emit the full updated list
    this.selectedOption = committed;
    this.selectedOptionSubject.next(committed);
    this.isOptionSelectedSubject.next(true);
  }

  setSelectedOptions(options: SelectedOption[]): void {
    const normalizedOptions = Array.isArray(options)
      ? options.filter(Boolean)
      : [];

    if (normalizedOptions.length === 0) {
      this.selectedOption = [];
      this.selectedOptionSubject.next([]);
      this.isOptionSelectedSubject.next(false);
      this.updateAnsweredState([], this.getFallbackQuestionIndex());
      return;
    }

    const groupedSelections = new Map<number, SelectedOption[]>();

    for (const option of normalizedOptions) {
      const qIndex = option?.questionIndex;

      if (qIndex === undefined || qIndex === null) {
        console.warn(
          '[setSelectedOptions] Missing questionIndex on option',
          option,
        );
        continue;
      }

      const enrichedOption: SelectedOption = this.canonicalizeOptionForQuestion(
        qIndex,
        {
          ...option,
          questionIndex: qIndex,
          selected: true,
          highlight: true,
          showIcon: true,
        },
      );

      if (
        enrichedOption?.optionId === undefined ||
        enrichedOption.optionId === null
      ) {
        console.warn(
          '[setSelectedOptions] Unable to resolve canonical optionId',
          {
            option,
            questionIndex: qIndex,
          },
        );
        continue;
      }

      const existing = groupedSelections.get(qIndex) ?? [];
      existing.push(enrichedOption);
      groupedSelections.set(qIndex, existing);
    }

    const combinedSelections: SelectedOption[] = [];

    for (const [questionIndex, selections] of groupedSelections) {
      // Commit selections for this question
      const committed = this.commitSelections(questionIndex, selections);
    
      // Always overwrite the map entry with ALL committed selections
      this.selectedOptionsMap.set(questionIndex, committed);
    
      // Aggregate globally
      if (committed.length > 0) {
        combinedSelections.push(...committed);
      }
    
      // Update answered state
      this.updateAnsweredState(committed, questionIndex);
    }

    if (combinedSelections.length === 0) {
      this.updateAnsweredState([], this.getFallbackQuestionIndex());
    }

    this.selectedOption = combinedSelections;
    this.selectedOptionSubject.next(combinedSelections);
    this.isOptionSelectedSubject.next(combinedSelections.length > 0);
  }

  setSelectedOptionsForQuestion(
    questionIndex: number,
    newSelections: SelectedOption[]
  ): void {
    // Treat incoming selections as the SINGLE source of truth
    const merged = new Map<number, SelectedOption>();

    // Apply current selections ONLY (authoritative)
    for (const opt of newSelections ?? []) {
      if (typeof opt.optionId === 'number') {
        merged.set(opt.optionId, {
          ...opt,
          questionIndex,
          selected: true
        });
      } else {
        console.warn('[SOS] Skipping option with invalid optionId', opt);
      }
    }

    const committed = Array.from(merged.values());

    // Overwrite the question entry completely
    this.selectedOptionsMap.set(questionIndex, committed);

    // Emit ONLY current question selections
    this.selectedOptionSubject.next(committed);

    this.isOptionSelectedSubject.next(committed.length > 0);
  }

  setSelectionsForQuestion(qIndex: number, selections: SelectedOption[]): void {
    const committed = this.commitSelections(qIndex, selections);
    this.selectedOptionSubject.next(committed);
  }

  getSelectedOptions(): SelectedOption[] {
    const combined: SelectedOption[] = [];
  
    for (const [, opts] of this.selectedOptionsMap) {
      if (Array.isArray(opts)) {
        combined.push(...opts);
      }
    }
  
    return combined;
  }

  public getSelectedOptionsForQuestion(
    questionIndex: number,
  ): SelectedOption[] {
    const options = this.selectedOptionsMap.get(questionIndex) || [];

    return options;  // return as-is — no cloning, no canonicalization
    
  }

  public areAllCorrectAnswersSelected(
    question: QuizQuestion,
    selectedOptionIds: Set<number>
  ): boolean {
    // Only get CORRECT option IDs, not ALL options
    const correctIds = question.options
      .filter(o => o.correct === true)  // filter for correct options first
      .map(o => o.optionId)
      .filter((id): id is number => typeof id === 'number');

    console.log('[areAllCorrectAnswersSelected] correctIds:', correctIds, 'selectedIds:', Array.from(selectedOptionIds));

    if (correctIds.length === 0) return false;

    for (const id of correctIds) {
      if (!selectedOptionIds.has(id)) {
        return false;
      }
    }

    return true;
  }

  clearSelectionsForQuestion(questionIndex: number): void {
    const idx = Number(questionIndex);
    if (!Number.isFinite(idx)) {
      console.warn(
        `[clearSelectionsForQuestion] ⚠️ Invalid index:`,
        questionIndex,
      );
      return;
    }

    // Remove from selection and feedback maps
    if (this.selectedOptionsMap.has(idx)) {
      this.selectedOptionsMap.delete(idx);
    }

    this.feedbackByQuestion.delete(idx);
    this.optionSnapshotByQuestion?.delete?.(idx);

    // Reset feedback UI if currently on this question
    if (this.quizService?.getCurrentQuestionIndex?.() === idx) {
      this.showFeedbackForOptionSubject.next({});
    }

    // Optional extra safety — clear any lingering lock states
    try {
      (this as any)._lockedOptionsMap?.delete?.(idx);
    } catch { }
  }

  // Method to get the current option selected state
  getCurrentOptionSelectedState(): boolean {
    return this.isOptionSelectedSubject.getValue();
  }

  getShowFeedbackForOption(): { [optionId: number]: boolean } {
    return this.showFeedbackForOptionSubject.getValue();
  }

  getFeedbackForQuestion(questionIndex: number): Record<string, boolean> {
    return { ...(this.feedbackByQuestion.get(questionIndex) ?? {}) };
  }

  republishFeedbackForQuestion(questionIndex: number): void {
    const selections = this.selectedOptionsMap.get(questionIndex) ?? [];

    if (!Array.isArray(selections) || selections.length === 0) {
      this.feedbackByQuestion.delete(questionIndex);

      if (this.quizService?.currentQuestionIndex === questionIndex) {
        this.showFeedbackForOptionSubject.next({});
      }

      return;
    }

    let feedback = this.feedbackByQuestion.get(questionIndex);
    if (!feedback || Object.keys(feedback).length === 0) {
      feedback = this.buildFeedbackMap(questionIndex, selections);
      this.feedbackByQuestion.set(questionIndex, feedback);
    }

    if (this.quizService?.currentQuestionIndex === questionIndex) {
      this.showFeedbackForOptionSubject.next({ ...feedback });
    }
  }

  private publishFeedbackForQuestion(index: number | null | undefined): void {
    const resolvedIndex =
      typeof index === 'number' && Number.isInteger(index)
        ? index
        : Number.isInteger(this.quizService?.currentQuestionIndex)
          ? (this.quizService.currentQuestionIndex as number)
          : null;

    if (resolvedIndex === null) {
      this.showFeedbackForOptionSubject.next({});
      return;
    }

    const cached = this.feedbackByQuestion.get(resolvedIndex) ?? {};
    this.showFeedbackForOptionSubject.next({ ...cached });
  }

  // Method to update the selected option state
  public async selectOption(
    optionId: number,
    questionIndex: number,
    text: string,
    isMultiSelect: boolean,
    optionsSnapshot?: Option[], // ← NEW (optional live snapshot)
  ): Promise<void> {
    console.warn('[SelectedOptionService] 🎯 selectOption CALLED:', { optionId, questionIndex, text, isMultiSelect });

    if (optionId == null || questionIndex == null || !text) {
      console.error('[SelectedOptionService] ❌ Invalid data - EARLY RETURN:', {
        optionId,
        questionIndex,
        text,
      });
      return;
    }

    // Resolve a best-effort index from the incoming text across common aliases.
    const q = this.quizService.questions?.[questionIndex];
    const options = Array.isArray(q?.options) ? q!.options : [];

    // Prefer the caller-provided snapshot (fresh UI state) if available
    const source: Option[] =
      Array.isArray(optionsSnapshot) && optionsSnapshot.length > 0
        ? optionsSnapshot
        : options;

    if (Array.isArray(source) && source.length > 0) {
      this.optionSnapshotByQuestion.set(
        questionIndex,
        source.map((option) => ({ ...option })),
      );
    } else {
      console.warn(
        `[SelectedOptionService] ⚠️ No options source available for snapshot Q${questionIndex + 1}`,
      );
    }

    const decodeHtml = (s: string) =>
      s
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
    const stripTags = (s: string) => s.replace(/<[^>]*>/g, ' ');
    const norm = (s: unknown) =>
      typeof s === 'string'
        ? stripTags(decodeHtml(s)).trim().toLowerCase().replace(/\s+/g, ' ')
        : '';
    const toNum = (v: unknown): number | null => {
      if (typeof v === 'number' && Number.isFinite(v)) return v; // 0 allowed
      const n = Number(String(v));
      return Number.isFinite(n) ? n : null;
    };

    const key = norm(text);
    const aliasFields = [
      'text',
      'value',
      'label',
      'name',
      'title',
      'displayText',
      'description',
      'html',
    ];

    const directMatch = this.matchOptionFromSource(
      source,
      optionId,
      text,
      aliasFields,
    );

    // Try to find a concrete index in the chosen source by matching text/value/aliases
    let fallbackIndexFromText = -1;
    for (let i = 0; i < source.length && fallbackIndexFromText < 0; i++) {
      const o: any = source[i];
      for (const f of aliasFields) {
        if (norm(o?.[f]) === key) {
          fallbackIndexFromText = i;
          break;
        }
      }
    }

    // Also try to resolve by id inside the same source (handle 0, string/number)
    let indexFromId = -1;
    for (let i = 0; i < source.length && indexFromId < 0; i++) {
      const oid = (source[i] as any)?.optionId;
      if (
        oid === optionId ||
        String(oid) === String(optionId) ||
        toNum(oid) === toNum(optionId)
      ) {
        indexFromId = i;
      }
    }

    // ⚠️ IMPORTANT: prefer a concrete index hint (from id or text) over raw text
    const resolverHint: number | string | undefined =
      indexFromId >= 0
        ? indexFromId
        : fallbackIndexFromText >= 0
          ? fallbackIndexFromText
          : (directMatch?.index ?? text);

    let canonicalOptionId = this.resolveCanonicalOptionId(
      questionIndex,
      optionId,
      resolverHint,
    );

    // Last-resort fallbacks: if resolver failed but we have a concrete index from the source, use it.
    if (canonicalOptionId == null) {
      if (indexFromId >= 0) {
        console.warn(
          '[SelectedOptionService] Resolver missed; using snapshot indexFromId',
          {
            questionIndex,
            optionId,
            text,
            indexFromId,
          },
        );
        canonicalOptionId = indexFromId;
      } else if (fallbackIndexFromText >= 0) {
        console.warn(
          '[SelectedOptionService] Resolver missed; using snapshot fallbackIndexFromText',
          {
            questionIndex,
            optionId,
            text,
            fallbackIndexFromText,
          },
        );
        canonicalOptionId = fallbackIndexFromText;
      } else if (directMatch?.option) {
        const resolved = toNum((directMatch.option as any)?.optionId);
        if (resolved !== null) {
          console.warn(
            '[SelectedOptionService] Resolver missed; using matched optionId from snapshot',
            {
              questionIndex,
              optionId,
              text,
              resolved,
            },
          );
          canonicalOptionId = resolved;
        } else {
          canonicalOptionId = directMatch.index;
        }
      }
    }

    if (canonicalOptionId == null) {
      // Log a compact snapshot to see why it failed.
      console.error('[SelectedOptionService] ❌ canonicalOptionId is null - EARLY RETURN', {
        optionId,
        questionIndex,
        text,
        optionsSnapshot: source.map((o: any, i: number) => ({
          i,
          id: o?.optionId,
          text: o?.text,
          value: o?.value,
          label: o?.label,
          name: o?.name,
          title: o?.title,
          displayText: o?.displayText,
        })),
      });
      return;
    }

    // Resolve the source option to extract 'correct' status
    let foundSourceOption: Option | undefined;

    // Priority 1: Use direct index if canonicalOptionId is an index into source
    if (
      typeof canonicalOptionId === 'number' &&
      canonicalOptionId >= 0 &&
      canonicalOptionId < source.length &&
      (source[canonicalOptionId]?.optionId === canonicalOptionId || source[canonicalOptionId]?.optionId === undefined)
    ) {
      foundSourceOption = source[canonicalOptionId];
    }

    // Priority 2: Use resolved indices from previous steps
    if (!foundSourceOption) {
      if (indexFromId >= 0) foundSourceOption = source[indexFromId];
      else if (fallbackIndexFromText >= 0) foundSourceOption = source[fallbackIndexFromText];
      else if (directMatch?.option) foundSourceOption = directMatch.option;
    }

    // Priority 3: Scan source for ID match
    if (!foundSourceOption) {
      foundSourceOption = source.find(o => String(o.optionId) === String(canonicalOptionId));
    }

    const newSelection: SelectedOption = {
      optionId: canonicalOptionId, // numeric id if available, else index
      questionIndex,
      text,
      correct: this.coerceToBoolean(foundSourceOption?.correct),
      selected: true,
      highlight: true,
      showIcon: true,
    };

    const currentSelections = this.selectedOptionsMap.get(questionIndex) || [];
    const canonicalCurrent = this.canonicalizeSelectionsForQuestion(
      questionIndex,
      currentSelections,
    );
    const filteredSelections = canonicalCurrent.filter(
      (s) =>
        !(
          s.optionId === canonicalOptionId && s.questionIndex === questionIndex
        ),
    );
    const updatedSelections = [...filteredSelections, newSelection];
    const committedSelections = this.commitSelections(
      questionIndex,
      updatedSelections,
    );

    if (!Array.isArray(this.selectedOptionIndices[questionIndex])) {
      this.selectedOptionIndices[questionIndex] = [];
    }
    if (
      !this.selectedOptionIndices[questionIndex].includes(canonicalOptionId)
    ) {
      this.selectedOptionIndices[questionIndex].push(canonicalOptionId);
    }

    this.selectedOptionSubject.next(committedSelections);

    // CRITICAL FIX: Emit to isAnsweredSubject so NextButtonStateService enables the button
    // This was the missing link - selectOption was updating isOptionSelectedSubject but not isAnsweredSubject
    this.isAnsweredSubject.next(true);
    console.log('[SelectedOptionService] isAnsweredSubject emitted TRUE');

    if (!isMultiSelect) {
      this.isOptionSelectedSubject.next(true);
      this.setNextButtonEnabled(true);
    } else {
      const selectedOptions = this.selectedOptionsMap.get(questionIndex) || [];

      // Multi-select: Next button is controlled elsewhere (QQC / QuizComponent)
      if (selectedOptions.length === 0) {
        console.warn('[⚠️ No selected options found for multi-select]');
        this.setNextButtonEnabled(false);
      }
    }
  }

  private isSelectedOptionType(obj: unknown): obj is SelectedOption {
    return (
      !!obj &&
      typeof obj === 'object' &&
      'optionId' in obj &&
      'questionIndex' in obj
    );
  }

  isOptionCurrentlySelected(option: Option): boolean {
    if (!option) return false;

    const currentIndex = this.quizService?.currentQuestionIndex ?? null;
    const indices =
      currentIndex != null
        ? [currentIndex]
        : Array.from(this.selectedOptionsMap.keys());

    const normId = this.normalizeOptionId(option.optionId);
    const normText = this.normalizeStr(option.text);
    const normValue = this.normalizeStr((option as any)?.value);

    for (const qIndex of indices) {
      const selections = this.selectedOptionsMap.get(qIndex) ?? [];

      const match = selections.some((sel) => {
        if (!sel) return false;
        if (sel.questionIndex !== qIndex) return false;

        const selId = this.normalizeOptionId(sel.optionId);
        const selText = this.normalizeStr(sel.text);
        const selValue = this.normalizeStr((sel as any)?.value);

        return (
          (normId !== null && normId === selId) ||
          (normText && normText === selText) ||
          (normValue && normValue === selValue)
        );
      });

      if (match) return true;
    }

    return false;
  }

  clearSelectedOption(): void {
    if (this.currentQuestionType === QuestionType.MultipleAnswer) {
      // Clear all selected options for multiple-answer questions
      this.selectedOptionsMap.clear();
      this.feedbackByQuestion.clear();
      this.optionSnapshotByQuestion.clear();
    } else {
      // Clear the single selected option for single-answer questions
      this.selectedOption = [];
      this.selectedOptionSubject.next([]);

      const activeIndex = Number.isInteger(
        this.quizService?.currentQuestionIndex,
      )
        ? (this.quizService.currentQuestionIndex as number)
        : null;

      if (activeIndex !== null) {
        this.feedbackByQuestion.delete(activeIndex);
        this.optionSnapshotByQuestion.delete(activeIndex);
      } else {
        this.feedbackByQuestion.clear();
        this.optionSnapshotByQuestion.clear();
      }
    }

    // Only clear feedback state here — do NOT touch answered state
    this.showFeedbackForOptionSubject.next({});
  }

  clearOptions(): void {
    this.selectedOptionSubject.next([]);
    this.feedbackByQuestion.clear();
    this.showFeedbackForOptionSubject.next({});
    this.optionSnapshotByQuestion.clear();
  }

  // Observable to get the current option selected state
  isOptionSelected$(): Observable<boolean> {
    return this.selectedOption$.pipe(
      startWith(this.selectedOptionSubject.getValue()), // emit the current state immediately when subscribed
      map((option) => option !== null), // determine if an option is selected
      distinctUntilChanged(), // emit only when the selection state changes
    );
  }

  // Method to set the option selected state
  setOptionSelected(isSelected: boolean): void {
    if (this.isOptionSelectedSubject.getValue() !== isSelected) {
      this.isOptionSelectedSubject.next(isSelected);
    }
  }

  getSelectedOptionIndices(questionIndex: number): number[] {
    const selectedOptions = this.selectedOptionsMap.get(questionIndex) || [];
    return selectedOptions
      .map((option) => option.optionId)
      .filter((id): id is number => id !== undefined);
  }

  addSelectedOptionIndex(questionIndex: number, optionIndex: number): void {
    const options = this.canonicalizeSelectionsForQuestion(
      questionIndex,
      this.selectedOptionsMap.get(questionIndex) || [],
    );
    const canonicalId = this.resolveCanonicalOptionId(
      questionIndex,
      optionIndex,
    );
    const existingOption = options.find((o) => o.optionId === canonicalId);

    if (!existingOption) {
      const canonicalOptions = this.getKnownOptions(questionIndex);
      const resolvedIndex =
        typeof canonicalId === 'number' && canonicalId >= 0
          ? canonicalId
          : optionIndex;

      const canonicalOption =
        Array.isArray(canonicalOptions) &&
          resolvedIndex >= 0 &&
          resolvedIndex < canonicalOptions.length
          ? canonicalOptions[resolvedIndex]
          : undefined;

      const baseOption: SelectedOption = canonicalOption
        ? { ...canonicalOption }
        : {
          optionId: canonicalId ?? optionIndex,
          text: `Option ${optionIndex + 1}`,
        };

      const newOption: SelectedOption = {
        ...baseOption,
        optionId: canonicalId ?? baseOption.optionId ?? optionIndex,
        questionIndex, // ensure the questionIndex is set correctly
        selected: true, // mark as selected since it's being added
      };

      options.push(newOption); // add the new option
      this.commitSelections(questionIndex, options); // update the map
    }
  }

  removeSelectedOptionIndex(questionIndex: number, optionIndex: number): void {
    if (Array.isArray(this.selectedOptionIndices[questionIndex])) {
      const optionPos =
        this.selectedOptionIndices[questionIndex].indexOf(optionIndex);
      if (optionPos > -1) {
        this.selectedOptionIndices[questionIndex].splice(optionPos, 1);
      }
    }

    const canonicalId = this.resolveCanonicalOptionId(
      questionIndex,
      optionIndex,
    );
    if (canonicalId == null) {
      console.warn(
        '[removeSelectedOptionIndex] Unable to resolve canonical optionId',
        {
          optionIndex,
          questionIndex,
        },
      );
      return;
    }

    const currentOptions = this.canonicalizeSelectionsForQuestion(
      questionIndex,
      this.selectedOptionsMap.get(questionIndex) || [],
    );

    const updatedOptions = currentOptions.filter(
      (option) => option.optionId !== canonicalId,
    );
    if (updatedOptions.length === currentOptions.length) return;

    this.commitSelections(questionIndex, updatedOptions);
  }

  // Add (and persist) one option for a question
  public addSelection(questionIndex: number, option: SelectedOption): void {
    // 1) Get or initialize the list for this question
    const list = this.canonicalizeSelectionsForQuestion(
      questionIndex,
      this.selectedOptionsMap.get(questionIndex) || [],
    );
    const canonicalOption = this.canonicalizeOptionForQuestion(
      questionIndex,
      option,
    );

    if (
      canonicalOption?.optionId === undefined ||
      canonicalOption.optionId === null
    ) {
      console.warn('[addSelection] Unable to resolve canonical optionId', {
        option,
        questionIndex,
      });
      return;
    }

    // 2) If this optionId is already in the list, skip
    if (list.some((sel) => sel.optionId === canonicalOption.optionId)) {
      return;
    }

    // 3) Enrich the option object with your flags
    const enriched: SelectedOption = {
      ...canonicalOption,
      selected: true,
      showIcon: true,
      highlight: true,
      questionIndex,
    };

    // 4) Append and persist
    list.push(enriched);
    const committed = this.commitSelections(questionIndex, list);
  }

  // Method to add or remove a selected option for a question
  public updateSelectionState(
    questionIndex: number,
    selectedOption: SelectedOption,
    isMultiSelect: boolean,
  ): void {
    let idx = Number(questionIndex);
    if (!Number.isFinite(idx) || idx < 0) idx = 0; // <-- pure numeric key

    const prevSelections = this.ensureBucket(idx).map((o) => ({ ...o })); // clone
    const canonicalSelected = this.canonicalizeOptionForQuestion(
      idx,
      selectedOption,
    );
    if (canonicalSelected?.optionId == null) {
      console.warn(
        '[updateSelectionState] Unable to resolve canonical optionId',
        { questionIndex, selectedOption },
      );
      return;
    }

    let updatedSelections: SelectedOption[];
    if (isMultiSelect) {
      const already = prevSelections.find(
        (opt) => opt.optionId === canonicalSelected.optionId,
      );
      updatedSelections = already
        ? prevSelections
        : [...prevSelections, { ...canonicalSelected }];
    } else {
      updatedSelections = [{ ...canonicalSelected }]; // single-answer: replace
    }

    this.commitSelections(idx, updatedSelections);
  }

  updateSelectedOptions(
    questionIndex: number,
    optionIndex: number,
    action: 'add' | 'remove',
  ): void {
    const canonicalId = this.resolveCanonicalOptionId(
      questionIndex,
      optionIndex,
    );
    if (canonicalId == null) {
      console.warn(
        '[updateSelectedOptions] Unable to resolve canonical optionId',
        {
          optionIndex,
          questionIndex,
          action,
        },
      );
      return;
    }

    const options = this.canonicalizeSelectionsForQuestion(
      questionIndex,
      this.selectedOptionsMap.get(questionIndex) || [],
    );

    const option = options.find((opt) => opt.optionId === canonicalId);
    if (!option) {
      console.warn(
        `[updateSelectedOptions] Option not found for optionIndex: ${optionIndex}`,
      );
      return;
    }

    if (action === 'add') {
      if (!options.some((opt) => opt.optionId === canonicalId)) {
        options.push(option);
      }
      option.selected = true;
    } else if (action === 'remove') {
      const idx = options.findIndex((opt) => opt.optionId === canonicalId);
      if (idx !== -1) options.splice(idx, 1);
    }

    const committed = this.commitSelections(questionIndex, options);

    if (committed && committed.length > 0) {
      this.updateAnsweredState(committed, questionIndex);
    }
  }

  updateAnsweredState(
    questionOptions: Option[] = [],
    questionIndex: number = -1,
  ): void {
    try {
      const resolvedIndex = this.resolveEffectiveQuestionIndex(
        questionIndex,
        questionOptions,
      );

      if (resolvedIndex == null || resolvedIndex < 0) {
        console.error(
          '[updateAnsweredState] Unable to resolve a valid question index.',
        );
        return;
      }

      const snapshot = this.buildCanonicalSelectionSnapshot(
        resolvedIndex,
        questionOptions,
      );

      if (!Array.isArray(snapshot) || snapshot.length === 0) {
        console.warn(
          '[updateAnsweredState] No option snapshot available for evaluation.',
        );
        return;
      }

      const isAnswered = snapshot.some((option) =>
        this.coerceToBoolean(option.selected),
      );
      this.isAnsweredSubject.next(isAnswered);

      const canonicalOptions = this.resolveCanonicalOptionsFor(resolvedIndex);
      const allCorrectAnswersSelected =
        this.determineIfAllCorrectAnswersSelected(
          resolvedIndex,
          snapshot,
          canonicalOptions,
        );

      // REMOVED: Timer stop is now handled in SharedOptionComponent.onOptionContentClick
      // with proper multi-answer logic
      // if (allCorrectAnswersSelected && !this.stopTimerEmitted) {
      //   this.stopTimer$.next();
      //   this.stopTimerEmitted = true;
      // }
    } catch (error) {
      console.error('[updateAnsweredState] Unhandled error:', error);
    }
  }

  private resolveEffectiveQuestionIndex(
    explicitIndex: number,
    questionOptions: Option[],
  ): number | null {
    if (typeof explicitIndex === 'number' && explicitIndex >= 0) {
      return explicitIndex;
    }

    const optionIndexFromPayload = Array.isArray(questionOptions)
      ? questionOptions
        .map((opt) => (opt as SelectedOption)?.questionIndex)
        .find((idx) => typeof idx === 'number' && idx >= 0)
      : undefined;

    if (typeof optionIndexFromPayload === 'number') {
      return optionIndexFromPayload;
    }

    const currentIndex = this.quizService?.getCurrentQuestionIndex?.();
    if (typeof currentIndex === 'number' && currentIndex >= 0) {
      return currentIndex;
    }

    const fallbackIndex = this.getFallbackQuestionIndex();
    return fallbackIndex >= 0 ? fallbackIndex : null;
  }

  private buildCanonicalSelectionSnapshot(
    questionIndex: number,
    overrides: Option[],
  ): Option[] {
    const canonicalOptions = this.getKnownOptions(questionIndex);

    const normalizedOverrides = Array.isArray(overrides)
      ? overrides.filter(Boolean)
      : [];
    const mapSelections = this.canonicalizeSelectionsForQuestion(
      questionIndex,
      this.selectedOptionsMap.get(questionIndex) || [],
    );

    const overlaySelections = new Map<number, Option>();

    const recordSelection = (option: Option, fallbackIdx?: number): void => {
      if (!option) {
        return;
      }

      const resolvedIdx = this.resolveOptionIndexFromSelection(
        canonicalOptions,
        option,
      );

      if (resolvedIdx != null && resolvedIdx >= 0) {
        overlaySelections.set(resolvedIdx, option);
      } else if (typeof fallbackIdx === 'number' && fallbackIdx >= 0) {
        overlaySelections.set(fallbackIdx, option);
      }
    };

    let idx = 0;
    for (const opt of normalizedOverrides) {
      recordSelection(opt, idx);
      idx++;
    }

    for (const opt of mapSelections) {
      recordSelection(opt);
    }

    const subjectOptions = this.quizService.currentOptions?.getValue();
    const dataOptions = Array.isArray(this.quizService.data?.currentOptions)
      ? this.quizService.data.currentOptions : [];

    const baseOptions =
      [
        canonicalOptions,
        Array.isArray(subjectOptions) ? subjectOptions : [],
        dataOptions,
        normalizedOverrides,
        mapSelections
      ].find((options) => Array.isArray(options) && options.length > 0) || [];

    return baseOptions.map((option, idx) => {
      const overlay = overlaySelections.get(idx);
      const mergedOption = {
        ...option,
        ...(overlay ?? {})
      } as Option;

      return {
        ...mergedOption,
        optionId: overlay?.optionId ?? option?.optionId ?? idx,
        correct: this.coerceToBoolean(
          (overlay as Option)?.correct ?? option?.correct,
        ),
        selected: this.coerceToBoolean(
          (overlay as Option)?.selected ?? option?.selected,
        ),
      };
    });
  }

  private resolveCanonicalOptionsFor(questionIndex: number): Option[] {
    const primaryOptions = this.quizService.questions?.[questionIndex]?.options;
    const selectedQuizOptions =
      this.quizService.selectedQuiz?.questions?.[questionIndex]?.options;
    const activeQuizOptions =
      this.quizService.activeQuiz?.questions?.[questionIndex]?.options;
    const subjectOptions = this.quizService.currentOptions?.getValue?.();
    const dataOptions = this.quizService.data?.currentOptions;

    const snapshotOptions = this.optionSnapshotByQuestion.get(questionIndex);

    const candidate = [
      primaryOptions,
      selectedQuizOptions,
      activeQuizOptions,
      subjectOptions,
      dataOptions,
      snapshotOptions,
    ].find((options) => Array.isArray(options) && options.length > 0);

    return Array.isArray(candidate)
      ? candidate.map((option) => ({ ...option }))
      : [];
  }

  private determineIfAllCorrectAnswersSelected(
    questionIndex: number,
    snapshot: Option[],
    canonicalOptions: Option[],
  ): boolean {
    if (!canonicalOptions || canonicalOptions.length === 0) {
      console.error('[CORRECTNESS] No canonical options');
      return false;
    }

    const correctIds = canonicalOptions
      .filter((o) => o.correct === true)
      .map((o) => String(o.optionId));

    // 🚨 No correct answers defined → NEVER auto-complete
    if (correctIds.length === 0) {
      console.error('[CORRECTNESS] Question has zero correct answers');
      return false;
    }

    const selectedIds = snapshot.map((o) => String(o.optionId));

    // ───────── SINGLE ANSWER ─────────
    if (correctIds.length === 1) {
      return selectedIds.length === 1 && selectedIds[0] === correctIds[0];
    }

    // ───────── MULTIPLE ANSWER ─────────
    if (selectedIds.length !== correctIds.length) {
      return false;
    }

    return correctIds.every((id) => selectedIds.includes(id));
  }

  public isSingleAnswerCorrectSync(questionIndex: number): boolean {
    const idx = this.normalizeQuestionIndex(questionIndex);

    const canonicalOptions = this.resolveCanonicalOptionsFor(idx);
    if (!canonicalOptions?.length) return false;

    const correct = canonicalOptions.find((o) => o.correct === true);
    const correctId =
      correct?.optionId != null ? String(correct.optionId) : null;
    if (!correctId) return false;

    const selected = this.getSelectedOptionsForQuestion(idx);
    const selectedId =
      selected?.[0]?.optionId != null ? String(selected[0].optionId) : null;

    console.warn('[SINGLE CORRECT CHECK]', {
      idx,
      correctId,
      selectedId,
      selected,
    });
    return !!selectedId && selectedId === correctId;
  }

  private collectCorrectOptionIds(
    questionIndex: number,
    canonicalOptions: Option[],
  ): Set<number> {
    const ids = new Set<number>();

    const recordFromOption = (option: Option, idx?: number): void => {
      if (!this.coerceToBoolean(option?.correct)) {
        return;
      }

      const canonicalId = this.resolveCanonicalOptionId(
        questionIndex,
        option?.optionId,
        idx,
      );

      if (canonicalId !== null) {
        ids.add(canonicalId);
      }
    };

    let idx = 0;
    for (const option of canonicalOptions) {
      recordFromOption(option, idx);
      idx++;
    }

    const questionText = this.resolveQuestionText(questionIndex);
    const mappedAnswers = questionText
      ? this.quizService.correctAnswers.get(questionText)
      : undefined;

    if (Array.isArray(mappedAnswers)) {
      for (const rawId of mappedAnswers) {
        const canonicalId = this.resolveCanonicalOptionId(questionIndex, rawId);
      
        if (canonicalId !== null) {
          ids.add(canonicalId);
        }
      }
    }

    const candidateOptionSets: Array<Option[] | undefined | null> = [
      this.quizService.questions?.[questionIndex]?.options,
      this.quizService.selectedQuiz?.questions?.[questionIndex]?.options,
      this.quizService.activeQuiz?.questions?.[questionIndex]?.options,
      this.quizService.correctOptions,
      this.quizService.currentOptions?.getValue?.(),
      this.quizService.data?.currentOptions,
      this.optionSnapshotByQuestion.get(questionIndex),
    ];

    for (const options of candidateOptionSets) {
      const normalized = Array.isArray(options) ? options.filter(Boolean) : [];
    
      let idx = 0;
      for (const option of normalized) {
        recordFromOption(option, idx);
        idx++;
      }
    }

    return ids;
  }

  private resolveQuestionText(questionIndex: number): string | null {
    const candidateQuestions = [
      this.quizService.questions?.[questionIndex],
      this.quizService.selectedQuiz?.questions?.[questionIndex],
      this.quizService.activeQuiz?.questions?.[questionIndex],
      this.quizService.currentQuestion?.getValue?.(),
    ];

    for (const question of candidateQuestions) {
      const text = question?.questionText;

      if (typeof text === 'string' && text.trim().length > 0) {
        return text.trim();
      }
    }

    const fallbackText = this.quizService.data?.questionText;

    return typeof fallbackText === 'string' && fallbackText.trim().length > 0
      ? fallbackText.trim()
      : null;
  }

  private coerceToBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }

      if (normalized === 'false' || normalized.length === 0) {
        return false;
      }
    }

    if (typeof value === 'number') {
      return value !== 0;
    }

    return false;
  }

  private normalizeOptionId(id: unknown): string | null {
    if (typeof id === 'number') {
      return Number.isFinite(id) ? String(id) : null;
    }

    if (typeof id === 'string') {
      const trimmed = id.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    return null;
  }

  private matchOptionFromSource(
    options: Option[],
    optionId: number | string | null | undefined,
    text: string,
    aliasFields: string[],
  ): { option: Option; index: number } | null {
    if (!Array.isArray(options) || options.length === 0) {
      return null;
    }

    const decodeHtml = (value: string) =>
      value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
    const stripTags = (value: string) => value.replace(/<[^>]*>/g, ' ');
    const normalize = (value: unknown) =>
      typeof value === 'string'
        ? stripTags(decodeHtml(value)).trim().toLowerCase().replace(/\s+/g, ' ')
        : '';

    const targetId = optionId != null ? String(optionId) : null;
    const targetNumeric = optionId != null ? Number(optionId) : null;
    const targetText = normalize(text);

    for (let i = 0; i < options.length; i++) {
      const candidate: any = options[i];

      if (targetId !== null) {
        const candidateId =
          candidate?.optionId != null ? String(candidate.optionId) : null;
        if (candidateId !== null && candidateId === targetId) {
          return { option: candidate, index: i };
        }

        const candidateNumeric =
          candidate?.optionId != null ? Number(candidate.optionId) : null;
        if (
          candidateNumeric !== null &&
          targetNumeric !== null &&
          Number.isFinite(candidateNumeric) &&
          Number.isFinite(targetNumeric) &&
          candidateNumeric === targetNumeric
        ) {
          return { option: candidate, index: i };
        }
      }

      if (targetText) {
        for (const field of aliasFields) {
          const candidateText = normalize(candidate?.[field]);
          if (candidateText && candidateText === targetText) {
            return { option: candidate, index: i };
          }
        }
      }
    }

    return null;
  }

  private getKnownOptions(questionIndex: number): Option[] {
    const canonical = this.quizService.questions?.[questionIndex]?.options;
    if (Array.isArray(canonical) && canonical.length > 0) {
      this.optionSnapshotByQuestion.set(
        questionIndex,
        canonical.map((option) => ({ ...option })),
      );
      return canonical;
    }

    const snapshot = this.optionSnapshotByQuestion.get(questionIndex);
    return Array.isArray(snapshot) ? snapshot : [];
  }

  private resolveCanonicalOptionId(
    questionIndex: number,
    rawId: number | string | null | undefined,
    fallbackIndexOrText?: number | string,
  ): number | null {
    const toFiniteNumber = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }

      const parsed = Number(String(value));
      return Number.isFinite(parsed) ? parsed : null;
    };

    const parseFallbackNumber = (): number | null => {
      const rawNumeric = toFiniteNumber(rawId);
      if (rawNumeric !== null) {
        return rawNumeric;
      }

      if (typeof fallbackIndexOrText === 'number') {
        return fallbackIndexOrText >= 0 ? fallbackIndexOrText : null;
      }

      if (typeof fallbackIndexOrText === 'string') {
        return toFiniteNumber(fallbackIndexOrText);
      }

      return null;
    };

    const options = this.getKnownOptions(questionIndex);
    if (options.length === 0) {
      return parseFallbackNumber();
    }

    const decodeHtml = (value: string) =>
      value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
    const stripTags = (value: string) => value.replace(/<[^>]*>/g, ' ');
    const normalize = (value: unknown) =>
      typeof value === 'string'
        ? stripTags(decodeHtml(value)).trim().toLowerCase().replace(/\s+/g, ' ')
        : '';

    const inBounds = (index: number | undefined) =>
      typeof index === 'number' && index >= 0 && index < options.length;

    const fallbackIndex =
      typeof fallbackIndexOrText === 'number' ? fallbackIndexOrText : undefined;
    const hintText =
      typeof fallbackIndexOrText === 'string' ? fallbackIndexOrText : undefined;
    const normalizedHint = hintText ? normalize(hintText) : null;

    const resolveFromIndex = (index: number): number => {
      const numericId = toFiniteNumber((options[index] as any)?.optionId);
      return numericId ?? index;
    };

    const aliasFields = [
      'text',
      'value',
      'label',
      'name',
      'title',
      'displayText',
      'html',
      'description',
    ];

    const lookupById = new Map<string | number, number>();
    const lookupByAlias = new Map<string, number>();

    const buildStableKey = (option: any): string => {
      const idPart = option?.optionId != null ? String(option.optionId) : '';
      const alias =
        aliasFields.map((field) => normalize(option?.[field])).find(Boolean) ||
        '';
      return `${questionIndex}|${idPart}|${alias}`;
    };

    let index = 0;
    for (const option of options) {
      if (option?.optionId !== null && option?.optionId !== undefined) {
        lookupById.set(option.optionId, index);

        const numericId = toFiniteNumber(option.optionId);
        if (numericId !== null) {
          lookupById.set(numericId, index);
        }

        lookupById.set(String(option.optionId), index);
      }

      for (const field of aliasFields) {
        const key = normalize((option as unknown as Record<string, unknown>)?.[field]);
        if (key) {
          lookupByAlias.set(key, index);
        }
      }

      lookupByAlias.set(normalize(buildStableKey(option)), index);

      index++;
    }

    if (rawId !== undefined && rawId !== null) {
      const rawNumeric = toFiniteNumber(rawId);
      const candidates: Array<string | number> = [rawId, String(rawId)];
      if (rawNumeric !== null) {
        candidates.push(rawNumeric);
      }

      for (const candidate of candidates) {
        const match = lookupById.get(candidate as any);
        if (match !== undefined) {
          return resolveFromIndex(match);
        }
      }

      if (rawNumeric !== null) {
        if (inBounds(rawNumeric) && fallbackIndex === undefined) {
          return rawNumeric;
        }

        const zeroBased = rawNumeric - 1;
        if (inBounds(zeroBased)) {
          return zeroBased;
        }
      }
    }

    if (normalizedHint) {
      const match = lookupByAlias.get(normalizedHint);
      if (match !== undefined) {
        return resolveFromIndex(match);
      }
    }

    if (inBounds(fallbackIndex)) {
      return resolveFromIndex(fallbackIndex!);
    }

    return null;
  }

  private extractNumericId(id: unknown): number | null {
    if (typeof id === 'number' && Number.isFinite(id)) {
      return id;
    }

    if (typeof id === 'string') {
      const parsed = Number(id);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private canonicalizeOptionForQuestion(
    questionIndex: number,
    option: SelectedOption,
    fallbackIndex?: number,
  ): SelectedOption {
    if (!option) {
      return option;
    }

    const canonicalId = this.resolveCanonicalOptionId(
      questionIndex,
      option.optionId,
      fallbackIndex,
    );

    if (canonicalId === null || canonicalId === option.optionId) {
      return option;
    }

    return {
      ...option,
      optionId: canonicalId,
    };
  }

  private canonicalizeSelectionsForQuestion(
    questionIndex: number,
    selections: SelectedOption[],
  ): SelectedOption[] {
    const canonical: SelectedOption[] = [];
    const seen = new Set<number>();

    for (const selection of selections ?? []) {
      if (!selection) {
        continue;
      }

      const canonicalSelection = this.canonicalizeOptionForQuestion(
        questionIndex,
        selection,
      );

      if (
        canonicalSelection?.optionId === undefined ||
        canonicalSelection.optionId === null
      ) {
        continue;
      }

      const id = canonicalSelection.optionId;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      canonical.push(canonicalSelection);
    }

    return canonical;
  }

  private commitSelections(
    questionIndex: number,
    selections: SelectedOption[],
  ): SelectedOption[] {
    // Always normalize to numeric key
    const idx = Number(questionIndex);
    if (!Number.isFinite(idx) || idx < 0) {
      console.warn(
        `[commitSelections] ⚠️ Invalid question index: ${questionIndex}`,
      );
      return [];
    }

    // Canonicalize and deep clone the selections
    const canonicalSelections = this.canonicalizeSelectionsForQuestion(
      idx,
      selections,
    ).map((sel) => ({ ...sel })); // ← ensure new object identity

    if (canonicalSelections.length > 0) {
      // Replace the old bucket completely
      this.selectedOptionsMap.set(idx, canonicalSelections);
    } else {
      this.selectedOptionsMap.delete(idx);
      this.optionSnapshotByQuestion.delete(idx);
    }

    this.syncFeedbackForQuestion(idx, canonicalSelections);

    // CRITICAL FIX: Update the "Answered" state whenever selections change.
    // This drives the Next Button enablement.
    this.updateAnsweredState(canonicalSelections, idx);
    console.log(`[commitSelections] Updated answered state for Q${idx}. Selections: ${canonicalSelections.length}`);

    return canonicalSelections;
  }

  private syncFeedbackForQuestion(
    questionIndex: number,
    selections: SelectedOption[],
  ): void {
    if (!Array.isArray(selections) || selections.length === 0) {
      this.feedbackByQuestion.delete(questionIndex);

      if (this.quizService?.currentQuestionIndex === questionIndex) {
        this.showFeedbackForOptionSubject.next({});
      }
      return;
    }

    const feedbackMap = this.buildFeedbackMap(questionIndex, selections);
    this.feedbackByQuestion.set(questionIndex, feedbackMap);

    if (this.quizService?.currentQuestionIndex === questionIndex) {
      this.showFeedbackForOptionSubject.next({ ...feedbackMap });
    }
  }

  private buildFeedbackMap(
    questionIndex: number,
    selections: SelectedOption[],
  ): Record<string, boolean> {
    const feedbackMap: Record<string, boolean> = {};

    for (const selection of selections ?? []) {
      if (!selection) {
        continue;
      }

      const keys = this.collectFeedbackKeys(questionIndex, selection);
      for (const key of keys) {
        if (key) {
          feedbackMap[String(key)] = true;
        }
      }
    }

    return feedbackMap;
  }

  private collectFeedbackKeys(
    questionIndex: number,
    selection: SelectedOption,
  ): Array<string | number> {
    const keys = new Set<string | number>();

    const normalizedSelectionId = this.normalizeOptionId(selection.optionId);
    if (normalizedSelectionId) {
      keys.add(normalizedSelectionId);
    }

    const numericSelectionId = this.extractNumericId(selection.optionId);
    if (numericSelectionId !== null) {
      keys.add(numericSelectionId);
    }

    if (selection.optionId !== undefined && selection.optionId !== null) {
      keys.add(selection.optionId);
    }

    const options = this.getKnownOptions(questionIndex);
    if (options.length > 0) {
      const resolvedIndex = this.resolveOptionIndexFromSelection(
        options,
        selection,
      );

      if (
        resolvedIndex !== null &&
        resolvedIndex >= 0 &&
        resolvedIndex < options.length
      ) {
        const option: any = options[resolvedIndex];

        const normalizedOptionId = this.normalizeOptionId(option?.optionId);
        if (normalizedOptionId) {
          keys.add(normalizedOptionId);
        }

        const numericOptionId = this.extractNumericId(option?.optionId);
        if (numericOptionId !== null) {
          keys.add(numericOptionId);
        }

        if (option?.optionId !== undefined && option?.optionId !== null) {
          keys.add(option.optionId);
        }

        keys.add(resolvedIndex);
      }
    }

    return Array.from(keys);
  }

  private normalizeQuestionIndex(index: number | null | undefined): number {
    if (!Number.isFinite(index as number)) {
      return -1;
    }

    const normalized = Math.trunc(index as number);
    const questions = this.quizService?.questions;

    if (!Array.isArray(questions) || questions.length === 0) {
      return normalized;
    }

    if (questions[normalized] != null) {
      return normalized;
    }

    const potentialOneBased = normalized - 1;
    if (
      potentialOneBased >= 0 &&
      potentialOneBased < questions.length &&
      questions[potentialOneBased] != null
    ) {
      return potentialOneBased;
    }

    return Math.min(Math.max(normalized, 0), questions.length - 1);
  }

  private evaluateAllCorrectSelections(snapshot: Option[]): boolean {
    if (!Array.isArray(snapshot) || snapshot.length === 0) {
      return false;
    }

    let totalCorrect = 0;
    let selectedCorrect = 0;

    for (const option of snapshot) {
      const isCorrect = this.coerceToBoolean(option?.correct);
      if (!isCorrect) {
        continue;
      }

      totalCorrect++;
      if (this.coerceToBoolean(option?.selected)) {
        selectedCorrect++;
      }
    }

    return totalCorrect > 0 && selectedCorrect === totalCorrect;
  }

  private normalizeStr(x: unknown): string {
    return typeof x === 'string'
      ? x.trim().toLowerCase().replace(/\s+/g, ' ')
      : '';
  }

  private resolveOptionIndexFromSelection(
    options: Option[],
    selection: any,
  ): number | null {
    // Build maps once from canonical options
    const byId = new Map<number | string, number>();
    const byText = new Map<string, number>();
    const byValue = new Map<string, number>();

    for (let i = 0; i < options.length; i++) {
      const o: any = options[i];

      // Map by id (0 is valid)
      if (o.optionId !== null && o.optionId !== undefined)
        byId.set(o.optionId, i);
      if (o.id !== null && o.id !== undefined) byId.set(o.id, i);

      // String keys (normalized)
      const t = this.normalizeStr(o.text);
      if (t) byText.set(t, i);

      const v = this.normalizeStr(o.value);
      if (v) byValue.set(v, i);
    }

    // 1) Strict id match (accept 0)
    if (
      'optionId' in selection &&
      selection.optionId !== null &&
      selection.optionId !== undefined
    ) {
      const hit = byId.get(selection.optionId);
      if (hit !== undefined) return hit;
    }
    if (
      'id' in selection &&
      selection.id !== null &&
      selection.id !== undefined
    ) {
      const hit = byId.get(selection.id);
      if (hit !== undefined) return hit;
    }

    // 2) Fallback by text
    const sText = this.normalizeStr(selection?.text);
    if (sText) {
      const hit = byText.get(sText);
      if (hit !== undefined) return hit;
    }

    // 3) Fallback by value
    const sValue = this.normalizeStr(selection?.value);
    if (sValue) {
      const hit = byValue.get(sValue);
      if (hit !== undefined) return hit;
    }

    console.warn(
      'Unable to determine a canonical optionId for selection',
      selection,
    );
    return null;
  }

  private resolveOptionIndexFromId(
    options: Option[],
    candidateId: unknown,
  ): number | null {
    if (!Array.isArray(options) || options.length === 0) {
      return null;
    }

    const normalizedTarget = this.normalizeOptionId(candidateId);
    if (normalizedTarget !== null) {
      const metadataMatch = options.findIndex(
        (opt) => this.normalizeOptionId(opt?.optionId) === normalizedTarget,
      );

      if (metadataMatch >= 0) {
        return metadataMatch;
      }
    }

    const numericId = this.extractNumericId(candidateId);
    if (numericId !== null) {
      if (numericId >= 0 && numericId < options.length) {
        return numericId;
      }

      const zeroBased = numericId - 1;
      if (zeroBased >= 0 && zeroBased < options.length) {
        return zeroBased;
      }
    }

    return null;
  }

  public isQuestionAnswered(questionIndex: number): boolean {
    const options = this.selectedOptionsMap.get(questionIndex);
    return Array.isArray(options) && options.length > 0;
  }

  setAnswered(isAnswered: boolean, force = false): void {
    const current = this.isAnsweredSubject.getValue();
    if (force || current !== isAnswered) {
      console.log('[🧪 EMIT CHECK] About to emit answered:', isAnswered);
      this.isAnsweredSubject.next(isAnswered);
      sessionStorage.setItem('isAnswered', JSON.stringify(isAnswered));
    } else {
      // Force re-emit even if value didn't change
      this.isAnsweredSubject.next(isAnswered);
    }
  }

  setAnsweredState(isAnswered: boolean): void {
    const current = this.isAnsweredSubject.getValue();

    if (current !== isAnswered) {
      this.isAnsweredSubject.next(isAnswered);
    } else {
      console.log(
        '[🟡 setAnsweredState] No change needed (already',
        current + ')',
      );
    }
  }

  getAnsweredState(): boolean {
    return this.isAnsweredSubject.getValue();
  }

  resetSelectedOption(): void {
    this.isOptionSelectedSubject.next(false);
  }

  resetSelectionState(): void {
    this.selectedOptionsMap.clear();
    this.selectedOption = [];
    this.selectedOptionSubject.next([]);
    this.showFeedbackForOptionSubject.next({});
    this.isOptionSelectedSubject.next(false);
    console.log('[🧼 Selection state fully reset]');
  }

  public resetOptionState(
    questionIndex?: number,
    optionsToDisplay?: Option[],
  ): void {
    try {
      if (typeof questionIndex === 'number') {
        const opts = this.selectedOptionsMap.get(questionIndex) ?? [];
        const cleared = opts.map((o) => ({
          ...o,
          selected: false,
          highlight: false,
          showIcon: false,
          disabled: false,
        }));
        this.selectedOptionsMap.set(questionIndex, cleared);
        console.log(
          `[SelectedOptionService] 🔄 Reset options for question ${questionIndex}`,
        );
      } else {
        this.selectedOptionsMap.clear();
        console.log(
          '[SelectedOptionService] 🔄 Reset options for ALL questions',
        );
      }

      // Also reset any visible array directly bound to the template
      if (Array.isArray(optionsToDisplay)) {
        for (const o of optionsToDisplay) {
          o.selected = false;
          o.highlight = false;
          o.showIcon = false;
          (o as any).disabled = false;
        }
      }
    } catch (err) {
      console.warn('[SelectedOptionService] ⚠️ resetOptionState failed:', err);
    }
  }

  public resetAllStates(): void {
    try {
      this.selectedOptionsMap.clear();
      this._lockedOptionsMap?.clear?.();
      this.optionStates?.clear?.();
      console.log(
        '[SelectedOptionService] 🧹 Cleared all selection/lock state',
      );
    } catch (err) {
      console.warn('[SelectedOptionService] ⚠️ resetAllStates failed', err);
    }
  }

  private getDefaultOptions(): Option[] {
    const defaultOptions = Array(4)
      .fill(null)
      .map((_, index) => ({
        optionId: index,
        text: `Default Option ${index + 1}`,
        correct: index === 0, // default to the first option as correct
        selected: false,
      }));
    return defaultOptions;
  }

  private getFallbackQuestionIndex(): number {
    const keys = Array.from(this.selectedOptionsMap.keys());
    if (keys.length > 0) {
      console.log(
        '[getFallbackQuestionIndex] Using fallback index from selectedOptionsMap:',
        keys[0],
      );
      return keys[0];
    }

    console.info(
      '[getFallbackQuestionIndex] No keys found in selectedOptionsMap. Unable to infer fallback question index.',
    );
    return -1;
  }

  public wasOptionPreviouslySelected(option: SelectedOption): boolean {
    const qIndex = option.questionIndex;
    const optId = option.optionId;

    if (qIndex == null || optId == null) return false;

    if (this.currentQuestionType === QuestionType.MultipleAnswer) {
      const options = this.selectedOptionsMap.get(qIndex);
      return options?.some((o) => o.optionId === optId) ?? false;
    } else {
      // Ensure selectedOption is not an array before accessing properties
      const singleSelected = this.selectedOption;
      if (this.isSelectedOptionType(singleSelected)) {
        return (
          singleSelected.optionId === optId &&
          singleSelected.questionIndex === qIndex
        );
      }
      return false;
    }
  }

  public evaluateNextButtonStateForQuestion(
    questionIndex: number,
    isMultiSelect: boolean,
    allowEmptySelection = false,
  ): void {
    // Defer to ensure setSelectedOption has updated the map this tick
    queueMicrotask(() => {
      const selected = this.selectedOptionsMap.get(questionIndex) ?? [];

      if (allowEmptySelection) {
        // Timer-expiry or external overrides may allow progression without a choice.
        // Preserve the "answered" state while keeping selection tracking honest.
        const anySelected = selected.length > 0;

        this.setAnswered(true);
        this.isOptionSelectedSubject.next(anySelected);
        this.nextButtonStateService.setNextButtonState(true);

        console.log('[🔓 Next Enabled] Override allowing empty selection', {
          questionIndex,
          anySelected,
        });

        return;
      }

      if (!isMultiSelect) {
        // Single → deterministic on first selection
        this.setAnswered(true); // stream sees answered=true
        this.isOptionSelectedSubject.next(true);
        this.nextButtonStateService.setNextButtonState(true);
        console.log('[🔓 Next Enabled] Single → first selection');
        return;
      }

      // Multi → enable on ANY selection (your policy)
      const anySelected = selected.length > 0;

      // Tell the stream it's answered so it won’t re-disable the button
      this.setAnswered(anySelected);

      this.isOptionSelectedSubject.next(anySelected);
      this.nextButtonStateService.setNextButtonState(anySelected);

      console.log(
        anySelected
          ? '[✅ Multi] at least one selected → Next enabled'
          : '[⛔ Multi] none selected → Next disabled',
      );
    });
  }

  isOptionLocked(qIndex: number, optId: string | number): boolean {
    return this._lockedByQuestion.get(qIndex)?.has(optId) ?? false;
  }

  lockOption(qIndex: number, optId: string | number): void {
    let set = this._lockedByQuestion.get(qIndex);
    if (!set) {
      set = new Set<string | number>();
      this._lockedByQuestion.set(qIndex, set);
    }
    set.add(optId);
  }

  lockMany(qIndex: number, optIds: (string | number)[]): void {
    let set = this._lockedByQuestion.get(qIndex);
    if (!set) {
      set = new Set<string | number>();
      this._lockedByQuestion.set(qIndex, set);
    }
    for (const id of optIds) {
      set!.add(id);
    }
  }

  lockQuestion(qIndex: number): void {
    if (Number.isFinite(qIndex)) {
      this._questionLocks.add(qIndex);
    }
  }

  unlockQuestion(qIndex: number): void {
    this._questionLocks.delete(qIndex);
  }

  isQuestionLocked(qIndex: number): boolean {
    return this._questionLocks.has(qIndex);
  }

  resetLocksForQuestion(qIndex: number): void {
    this._lockedByQuestion.delete(qIndex);
    this._questionLocks.delete(qIndex);
  }

  // --- shared identity helpers ---
  private normKey(x: unknown): string {
    if (x == null) return '';
    return String(x).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private forEachUiMatch(
    canonical: Option[],
    ui: Option[] | undefined,
    cb: (canonIndex: number, uiItem: Option) => void,
  ): void {
    if (!Array.isArray(canonical) || canonical.length === 0) return;
    if (!Array.isArray(ui) || ui.length === 0) return;

    const idxByKey = new Map<string, number>();
    for (let i = 0; i < canonical.length; i++) {
      const c: any = canonical[i];
      // 0 is valid — use nullish checks, not truthy
      const key = this.normKey(c.optionId ?? c.id ?? c.value ?? c.text ?? i);
      if (key) idxByKey.set(key, i);
    }

    for (const u of ui) {
      const uu: any = u;
      const key = this.normKey(uu.optionId ?? uu.id ?? uu.value ?? uu.text);
      const i = key ? idxByKey.get(key) : undefined;
      if (i !== undefined) cb(i, u);
    }
  }

  // --- keep your overlay (pure, returns a snapshot) ---
  public overlaySelectedByIdentity(
    canonical: Option[],
    ui: Option[],
  ): Option[] {
    if (!Array.isArray(canonical) || canonical.length === 0) return [];
    const out = canonical.map((o) => ({ ...o, selected: false }));

    this.forEachUiMatch(canonical, ui, (i, u) => {
      out[i].selected = !!(u as any).selected;
    });

    return out;
  }

  // --- add sync (mutates canonical in-place) ---
  public syncSelectionsToCanonical(questionIndex: number, ui: Option[]): void {
    const canonical = this.getKnownOptions(questionIndex);
    if (!Array.isArray(canonical) || canonical.length === 0) return;

    // Clear previous selected flags (optional; remove if you want "sticky" selections)
    for (const c of canonical as any[]) c.selected = !!c.selected && false;

    this.forEachUiMatch(canonical, ui, (i, u) => {
      (canonical[i] as any).selected = !!(u as any).selected;
    });
  }

  public clearLockedOptions(): void {
    try {
      if (
        (this as any)._lockedOptionsMap &&
        typeof (this as any)._lockedOptionsMap.clear === 'function'
      ) {
        (this as any)._lockedOptionsMap.clear();
        console.log('[SelectedOptionService] 🔓 Cleared all locked options');
      } else {
        console.log(
          '[SelectedOptionService] ℹ️ No _lockedOptionsMap found — skipping',
        );
      }
    } catch (err) {
      console.warn('[SelectedOptionService] ⚠️ clearLockedOptions failed', err);
    }
  }

  private ensureBucket(idx: number): SelectedOption[] {
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    if (!this.selectedOptionsMap.has(idx)) this.selectedOptionsMap.set(idx, []);
    return this.selectedOptionsMap.get(idx)!;
  }

  public reapplySelectionForQuestion(option: Option, index: number): void {
    console.log('[SelectedOptionService] Reapplying selection for Q', index);

    // mark as selected again
    option.selected = true;

    // mark question as answered
    this.setAnswered(true);

    // let your existing pipelines react naturally
  }

  /**
   * Returns true ONLY if the user has selected:
   *  - every correct option for this question, AND
   *  - no incorrect options.
   *
   * Returns false for:
   *  - partial correct selections,
   *  - selections including any incorrect option,
   *  - invalid question index,
   *  - no selections,
   *  - single-answer questions with incorrect option.
   */
  public areAllCorrectAnswersSelectedActiveQuestion(): boolean {
    try {
      const qIndex = this.quizService.currentQuestionIndexSource.getValue();

      const question = this._questionCache.get(qIndex);
      if (!question || !Array.isArray(question.options)) {
        console.warn('[SOS] No cached question for index:', qIndex);
        return false;
      }

      const selected = this.getSelectedOptionsForQuestion(qIndex) ?? [];
      if (selected.length === 0) return false;

      const correctOptions = question.options.filter((o) => o.correct === true);
      const correctIds = new Set(correctOptions.map((o) => String(o.optionId)));

      const selectedIds = new Set(
        selected.map((o) => String((o as any).optionId ?? '')),
      );

      // Reject immediately if selected any incorrect option
      for (const id of selectedIds) {
        if (!correctIds.has(id)) return false;
      }

      // Exact match only
      return (
        correctIds.size > 0 &&
        selectedIds.size === correctIds.size &&
        [...selectedIds].every((id) => correctIds.has(id))
      );
    } catch (err) {
      console.error('[SOS] Error evaluating correctness:', err);
      return false;
    }
  }

  public storeQuestion(index: number, question: QuizQuestion): void {
    if (question) {
      this._questionCache.set(index, question);
    }
  }

  public isQuestionComplete(
    question: QuizQuestion,
    selected: SelectedOption[],
  ): boolean {
    if (!question || !Array.isArray(question.options)) return false;

    const selectedIds = new Set<number>(
      (selected ?? [])
        .map(o => o.optionId)
        .filter((id): id is number => typeof id === 'number'),
    );

    if (selectedIds.size === 0) return false;

    // Get correct option IDs
    const correctIds = question.options
      .filter(o => o.correct === true)
      .map(o => o.optionId)
      .filter((id): id is number => typeof id === 'number');

    if (correctIds.length === 0) return false;

    // Infer question type from data if not explicitly set
    const isMultipleAnswer =
      question.type === QuestionType.MultipleAnswer ||
      correctIds.length > 1;

    console.log(`[isQuestionComplete] type=${question.type}, isMulti=${isMultipleAnswer}, correctIds=${correctIds.length}, selectedIds=${selectedIds.size}`);

    // SINGLE-ANSWER: complete after one selection
    if (!isMultipleAnswer) {
      return selectedIds.size === 1;
    }

    // MULTIPLE-ANSWER: complete only when ALL correct options are selected
    return correctIds.every(id => selectedIds.has(id));
  }
}