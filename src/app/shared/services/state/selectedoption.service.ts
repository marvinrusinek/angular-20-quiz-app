import { Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, Subject } from 'rxjs';
import { distinctUntilChanged, map, startWith } from 'rxjs/operators';

import { QuestionType } from '../../models/question-type.enum';
import { Option } from '../../models/Option.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { SelectedOption } from '../../models/SelectedOption.model';
import { AnswerEvaluationService } from './answer-evaluation.service';
import { NextButtonStateService } from './next-button-state.service';
import { OptionFeedbackStateService } from './option-feedback-state.service';
import { OptionIdResolverService } from './option-id-resolver.service';
import { OptionLockStateService } from './option-lock-state.service';
import { SelectionPersistenceService } from './selection-persistence.service';
import { QuizService } from '../data/quiz.service';

@Injectable({ providedIn: 'root' })
export class SelectedOptionService {
  selectedOption: SelectedOption[] = [];
  selectedOptionsMap = new Map<number, SelectedOption[]>();
  /** The option from the most recent click (set by setSelectedOption). */
  lastClickedOption: SelectedOption | null = null;
  /** Per-question: was the last clicked option correct? Set by QQC directly. */
  lastClickedCorrectByQuestion = new Map<number, boolean>();
  /** Stable click-confirmed dot status. Set on user click, never overwritten
   *  by async evaluations. Only cleared on quiz restart. */
  clickConfirmedDotStatus = new Map<number, 'correct' | 'wrong'>();
  // Direct storage without canonicalization - more reliable for results display
  rawSelectionsMap = new Map<number, { optionId: number; text: string }[]>();
  selectedOptionIndices: { [key: number]: number[] } = {};

  // Durable backup that survives clearState() — used for refresh restore.
  // Auto-cleared after 5s so stale data doesn't leak into future sessions.
  _refreshBackup = new Map<number, SelectedOption[]>();

  // Accumulates ALL selections per question (including prior single-answer picks)
  // so that _wasSelected-style highlights survive refresh.
  _selectionHistory = new Map<number, SelectedOption[]>();

  /** Add entries to selection history without replacing existing ones.
   *  Used by the correct-click handler to persist previously-clicked wrong
   *  options so that subsequent saveState() calls don't lose them. */
  addToSelectionHistory(questionIndex: number, entries: SelectedOption[]): void {
    const history = this._selectionHistory.get(questionIndex) ?? [];
    for (const entry of entries) {
      const already = history.some(h =>
        h.optionId === entry.optionId
        && h.displayIndex === entry.displayIndex
      );
      if (!already) {
        history.push(entry);
      }
    }
    this._selectionHistory.set(questionIndex, history);
  }

  get hasRefreshBackup(): boolean {
    return this._refreshBackup.size > 0;
  }

  getRefreshBackup(idx: number): SelectedOption[] {
    return this._refreshBackup.get(idx) ?? [];
  }

  clearRefreshBackup(): void {
    this._refreshBackup.clear();
  }

  private scheduleBackupClear(): void {
    setTimeout(() => {
      this._refreshBackup.clear();
    }, 5000);
  }

  private loadState(): void {
    this.persistence.loadState(this as any);
  }

  private saveState(): void {
    this.persistence.saveState(this as any);
  }

  public clearState(): void {
    this.selectedOptionsMap.clear();
    this.rawSelectionsMap.clear();
    this._selectionHistory.clear();
    this.selectedOption = [];
    this.selectedOptionIndices = {};
    this.feedbackState.clearAll();
    this.optionSnapshotByQuestion.clear();
    this.lockState.clearAll();
    this.optionStates.clear();
    this.isAnsweredSig.set(false);
    this.isOptionSelectedSig.set(false);
    this.selectedOptionsMapSig.set(new Map());

    try {
      this.persistence.clearSessionKeys();
      // Clear per-question selection keys used by rehydrateUiFromState
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith('sel_Q') || key?.startsWith('displayMode_')) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        sessionStorage.removeItem(key);
      }
    } catch (err) {
      // ignore
    }
  }

  public resetAllOptions(): void {
    this.clearState();
    this.selectedOptionSig.set([]);
    this.isOptionSelectedSig.set(false);
    this.isAnsweredSig.set(false);
  }

  // ── Signal-first state ─────────────────────────────────────────
  readonly selectedOptionSig = signal<SelectedOption[]>([]);
  selectedOption$ = toObservable(this.selectedOptionSig);

  readonly selectedOptionExplanationSig = signal<string>('');
  selectedOptionExplanation$ = toObservable(this.selectedOptionExplanationSig);

  readonly isOptionSelectedSig = signal<boolean>(false);

  readonly isAnsweredSig = signal<boolean>(false);
  isAnswered$: Observable<boolean> = toObservable(this.isAnsweredSig);
  public answered$ = this.isAnswered$;

  private _questionCache = new Map<number, QuizQuestion>();

  readonly questionTextSig = signal<string>('');
  questionText$ = toObservable(this.questionTextSig);

  readonly selectedOptionsMapSig = signal<Map<number, SelectedOption[]>>(new Map());
  public selectedOptionsMap$ = toObservable(this.selectedOptionsMapSig);

  // Feedback state delegated to OptionFeedbackStateService
  get showFeedbackForOptionSig() {
    return this.feedbackState.showFeedbackForOptionSig;
  }
  get showFeedbackForOption$() {
    return this.feedbackState.showFeedbackForOption$;
  }
  private optionSnapshotByQuestion = new Map<number, Option[]>();

  readonly isNextButtonEnabledSig = signal<boolean>(false);

  stopTimer$ = new Subject<void>();
  stopTimerEmitted = false;

  currentQuestionType: QuestionType | null = null;
  // Lock state delegated to OptionLockStateService
  public get _lockedOptionsMap(): Map<number, Set<number>> {
    return this.lockState._lockedOptionsMap;
  }
  public optionStates: Map<number, any> = new Map();

  set isNextButtonEnabled(value: boolean) {
    this.isNextButtonEnabledSig.set(value);
  }

  get isNextButtonEnabled$(): Observable<boolean> {
    return toObservable(this.isNextButtonEnabledSig);
  }

  constructor(
    private quizService: QuizService,
    private nextButtonStateService: NextButtonStateService,
    private idResolver: OptionIdResolverService,
    private lockState: OptionLockStateService,
    private feedbackState: OptionFeedbackStateService,
    private answerEval: AnswerEvaluationService,
    private persistence: SelectionPersistenceService
  ) {
    this.loadState();
    const index$ = this.quizService?.currentQuestionIndex$;
    if (index$) {
      index$.pipe(distinctUntilChanged()).subscribe((index) => {
        this.stopTimerEmitted = false;
        this.publishFeedbackForQuestion(index);
      });
    }

    // Reset Sync: Automatically clear all selections when QuizService resets
    this.quizService.quizReset$.subscribe(() => {
      this.resetAllOptions();
    });
  }

  isSelectedOption(option: Option): boolean {
    return (
      this.selectedOption?.some((sel) => sel.optionId === option.optionId) ??
      false
    );
  }

  // Helper to sync state from external components (like SharedOptionComponent)
  syncSelectionState(questionIndex: number, options: SelectedOption[]): void {
    // Store RAW selections to a DURABLE location that survives clearState/resetAll.
    // clearState() wipes rawSelectionsMap, selectedOptionsMap, AND sessionStorage.
    // Only localStorage with a distinct key survives every reset path.
    if (Array.isArray(options) && options.length > 0) {
      const rawSelections = options
        .filter(o => o != null)
        .map(o => ({
          optionId: typeof o.optionId === 'number' ? o.optionId : -1,
          text: o.text || ''
        }))
        .filter(o => o.optionId >= 0 || o.text);
      if (rawSelections.length > 0) {
        this.rawSelectionsMap.set(questionIndex, rawSelections);
        // Persist to durable localStorage key that NO reset path touches
        this.persistAnswerForResults(questionIndex, rawSelections);
      }
    }

    const committed = this.commitSelections(questionIndex, options);

    // Accumulate selection history. syncSelectionState is invoked from the
    // click pipeline (option-interaction.service) for every user click;
    // without this push, single-answer mode wipes the map on each click and
    // the only durable record of prior wrong picks lives in _selectionHistory.
    // Skip the push on empty committed (deselect-all path).
    if (committed.length > 0) {
      const history = this._selectionHistory.get(questionIndex) ?? [];
      for (const c of committed) {
        if (!c || c.optionId == null) continue;
        const cText = ((c as any).text ?? '').trim().toLowerCase();
        const dup = history.some(h =>
          h.optionId === c.optionId &&
          (((h as any).text ?? '').trim().toLowerCase() === cText)
        );
        if (!dup) {
          history.push({
            ...c,
            selected: true,
            highlight: true,
            showIcon: true
          } as any);
        }
      }
      this._selectionHistory.set(questionIndex, history);
    }

    // VITAL: Update the map so that getSelectedOptionsForQuestion(index) returns the new state!
    this.selectedOptionsMap.set(questionIndex, committed);
    this.selectedOptionsMapSig.set(new Map(this.selectedOptionsMap));

    this.selectedOption = committed;
    this.selectedOptionSig.set(committed);
    this.isOptionSelectedSig.set(committed.length > 0);
    this.isAnsweredSig.set(true);

    // Persist to sessionStorage so data survives navigation
    this.saveState();
  }

  private persistAnswerForResults(questionIndex: number, selections: { optionId: number; text: string }[]): void {
    this.persistence.persistAnswerForResults(questionIndex, selections);
  }

  public recoverAnswersForResults(): void {
    this.persistence.recoverAnswersForResults(this.rawSelectionsMap);
  }

  public clearAnswersForResults(): void {
    this.persistence.clearAnswersForResults();
  }

  deselectOption(): void {
    this.selectedOptionSig.set([]);
    this.isOptionSelectedSig.set(false);
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

    // Trust: questionIndex is 0-based (QQC is the source of truth now)
    const idx = Number.isFinite(questionIndex) ? Math.trunc(questionIndex) : -1;

    if (idx < 0) {
      console.error('[SOS] Invalid questionIndex passed to addOption:', { questionIndex });
      return;
    }

    // Get existing selections for this question
    const existing = this.selectedOptionsMap.get(idx) ?? [];

    // Canonicalize existing options
    const existingCanonical = this.idResolver.canonicalizeSelectionsForQuestion(
      idx,
      existing
    );

    const fallbackIdx = (option as any).index ?? (option as any).displayIndex ?? (option as any).idx;
    const newCanonical = this.idResolver.canonicalizeOptionForQuestion(idx, {
      ...option,
      displayIndex: fallbackIdx,          // preserve for syncService lookup
      questionIndex: idx,                 // keep stored option consistent
      selected: option.selected ?? true,
      highlight: true,
      showIcon: true
    }, option.text || fallbackIdx);

    if (newCanonical.optionId == null) {
      console.error('[SOS] canonical option missing ID:', newCanonical);
      return;
    }

    // AUTHORITATIVE MERGE (REPLACE BY unique key: optionId + index)
    const merged = new Map<string, SelectedOption>();
    const isCorrectHelper = (o: any) => o && (o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1');

    // Keep existing selections (as a base)
    for (const o of existingCanonical) {
      if (o.optionId != null) {
        const key = `${o.optionId}|${o.displayIndex ?? -1}`;
        merged.set(key, o);
      }
    }

    // Apply new selection (replace by unique key)
    if (newCanonical.optionId != null) {
      const key = `${newCanonical.optionId}|${newCanonical.displayIndex ?? -1}`;
      if (newCanonical.selected === false) {
        merged.delete(key);  // support unselect if needed
      } else {
        // Force insertion order update so this becomes the "most recent" selection
        merged.delete(key);
        merged.set(key, newCanonical);
      }
    }

    // Commit selections and store the result
    // IMPORTANT: commitSelections ensures object identities are preserved 
    // and correctly applies the exclusive highlight logic.
    const mergedList = Array.from(merged.values());
    const committed = this.commitSelections(idx, mergedList);
    this.selectedOptionsMap.set(idx, committed); // VITAL: Update the map!

    // Accumulate selection history for refresh restore (mirrors _wasSelected behavior)
    for (const sel of committed) {
      const history = this._selectionHistory.get(idx) ?? [];
      const alreadyInHistory = history.some(h =>
        h.optionId === sel.optionId
        && h.displayIndex === sel.displayIndex
        && (h.text ?? '') === (sel.text ?? '')
      );
      if (!alreadyInHistory) {
        history.push(sel);
        this._selectionHistory.set(idx, history);
      }
    }

    // PROACTIVE SYNC: Ensure QuizService knows about this answer immediately.
    // This drives calculateAnsweredCount and progress persistence.
    if (this.quizService) {
      const ids = committed
        .map((o: any) => o.optionId)
        .filter((id: any): id is number => typeof id === 'number');
      this.quizService.updateUserAnswer(idx, ids);
    }

    this.saveState();

    // Emit observable updates
    this.selectedOption = committed;
    this.selectedOptionSig.set(committed);
    this.isOptionSelectedSig.set(committed.length > 0);
  }

  // Removes an option from the selectedOptionsMap
  removeOption(questionIndex: number, optionId: number | string, indexHint?: number): void {
    const canonicalId = this.idResolver.resolveCanonicalOptionId(questionIndex, optionId, indexHint);
    if (canonicalId == null && indexHint == null) {
      return;
    }

    const currentOptions = this.idResolver.canonicalizeSelectionsForQuestion(
      questionIndex,
      this.selectedOptionsMap.get(questionIndex) || []
    );
    const updatedOptions = currentOptions.filter(
      (o) => {
        const matchesId = (o.optionId === canonicalId || (canonicalId === null && o.optionId === -1));
        const matchesIndex = (indexHint != null) ?
          (o.displayIndex === indexHint || (o as any).index === indexHint) :
          true;
        return !(matchesId && matchesIndex);
      }
    );

    if (updatedOptions.length > 0) {
      const committed = this.commitSelections(questionIndex, updatedOptions);
      this.selectedOptionsMap.set(questionIndex, committed);

      if (this.quizService) {
        const ids = committed
          .map((o: any) => o.optionId)
          .filter((id: any): id is number => typeof id === 'number');
        this.quizService.updateUserAnswer(questionIndex, ids);
      }

      this.selectedOption = committed;
      this.selectedOptionSig.set(committed);
      this.isOptionSelectedSig.set(committed.length > 0);
      this.updateAnsweredState(committed, questionIndex);
    } else {
      this.selectedOptionsMap.delete(questionIndex);

      if (this.quizService) {
        this.quizService.updateUserAnswer(questionIndex, []);
      }

      this.selectedOption = [];
      this.selectedOptionSig.set([]);
      this.isOptionSelectedSig.set(false);
      this.setAnswered(false, true); // Update answered state
      this.setNextButtonEnabled(false); // Explicitly disable next button
    }
    this.saveState();
  }

  setNextButtonEnabled(enabled: boolean): void {
    this.isNextButtonEnabledSig.set(enabled);  // update the button's enabled state
  }

  clearSelection(): void {
    this.isOptionSelectedSig.set(false);  // no option selected
  }

  clearOtherSelections(questionIndex: number, keepOptionId: number): void {
    const current = this.selectedOptionsMap.get(questionIndex) || [];
    this.selectedOptionsMap.set(
      questionIndex,
      current.filter(o => o.optionId === keepOptionId)
    );
  }

  public clearAllSelectionsForQuestion(questionIndex: number): void {
    const idx = this.idResolver.normalizeQuestionIndex(questionIndex);
    if (idx < 0) return;

    // Canonical selection state
    this.selectedOptionsMap.set(idx, []);
    this.selectedOptionIndices[idx] = [];

    // Clear accumulated history so saveState() doesn't re-merge stale
    // wrong-click entries back into sel_Q*. The live interaction uses
    // _multiSelectByQuestion (not _selectionHistory) for the binding
    // rebuild, so this is safe.
    this._selectionHistory.delete(idx);

    // Clear the durable per-question sessionStorage key BEFORE saveState
    // runs — otherwise saveState's merge reads the old key and re-adds
    // entries that were just cleared. This prevents stale wrong-click
    // entries from accumulating across multiple click attempts.
    this.persistence.clearPerQuestionSessionKey(idx);

    // Snapshot used by correctness logic
    this.optionSnapshotByQuestion.delete(idx);

    // Timer / correctness flags
    this.stopTimerEmitted = false;

    // Emit clean state so UI updates
    try {
      this.selectedOptionSig.set([]);
    } catch { }

    try {
      this.isOptionSelectedSig.set(false);
    } catch { }

    this.saveState();
  }

  setSelectedOption(
    option: SelectedOption | null,
    questionIndex?: number,
    optionsSnapshot?: Option[],
    isMultipleAnswer?: boolean
  ): void {
    if (!option) {
      if (questionIndex == null) {
        return;
      }
      this.selectedOptionsMap.delete(questionIndex);
      this.selectedOptionSig.set([]);
      this.isOptionSelectedSig.set(false);
      this.updateAnsweredState();
      return;
    }

    const qIndex = questionIndex ?? option.questionIndex;
    if (qIndex == null) {
      console.error('[setSelectedOption] Missing questionIndex', {
        option,
        questionIndex
      });
      return;
    }

    // Populate snapshot if provided
    if (optionsSnapshot && optionsSnapshot.length > 0) {
      this.optionSnapshotByQuestion.set(qIndex, optionsSnapshot);
    } else {
    }

    const enriched: SelectedOption = this.idResolver.canonicalizeOptionForQuestion(
      qIndex,
      {
        ...option,
        questionIndex: qIndex,
        selected: true,
        highlight: true,
        showIcon: true
      },
      option.text || (option as any).index
    );

    // HARD RULE: Single-answer questions may never accumulate selections
    if (isMultipleAnswer === false) {
      this.selectedOptionsMap.set(qIndex, []);
    }

    const current = this.selectedOptionsMap.get(qIndex) || [];
    let canonicalCurrent = this.idResolver.canonicalizeSelectionsForQuestion(
      qIndex,
      current
    );

    // If single answer, clear previous selections
    if (isMultipleAnswer === false) {
      canonicalCurrent = [];
    }

    const exists = canonicalCurrent.find(
      (sel) => sel.optionId === enriched.optionId &&
        (sel.displayIndex === enriched.displayIndex || (sel as any).index === (enriched as any).index)
    );

    if (isMultipleAnswer) {
      if (exists) {
        // Toggle OFF
        canonicalCurrent = canonicalCurrent.filter(
          (sel) => !(sel.optionId === enriched.optionId &&
            (sel.displayIndex === enriched.displayIndex || (sel as any).index === (enriched as any).index))
        );
      } else {
        // Toggle ON
        canonicalCurrent.push(enriched);
      }
    } else {
      // Single answer
      canonicalCurrent = [enriched];
    }

    // Accumulate selection history for refresh restore (mirrors _wasSelected behavior)
    const history = this._selectionHistory.get(qIndex) ?? [];
    const alreadyInHistory = history.some(h =>
      h.optionId === enriched.optionId
      && h.displayIndex === enriched.displayIndex
      && (h.text ?? '') === (enriched.text ?? '')
    );
    if (!alreadyInHistory) {
      history.push(enriched);
      this._selectionHistory.set(qIndex, history);
    }

    const committed = this.commitSelections(qIndex, canonicalCurrent);
    this.selectedOptionsMap.set(qIndex, committed); // VITAL: Update the map!
    this.saveState();

    // Sync to QuizService for persistence & scoring
    if (this.quizService) {
      const ids = committed
        .map(o => o.optionId)
        .filter((id): id is number => typeof id === 'number');
      this.quizService.updateUserAnswer(qIndex, ids);
    }

    // Track the clicked option for per-click dot color in multi-answer
    this.lastClickedOption = enriched;

    // Synchronously emit the full updated list
    this.selectedOption = committed;
    this.selectedOptionSig.set(committed);
    this.isOptionSelectedSig.set(true);
  }

  setSelectedOptions(options: SelectedOption[]): void {
    const normalizedOptions = Array.isArray(options)
      ? options.filter(Boolean)
      : [];

    if (normalizedOptions.length === 0) {
      this.selectedOption = [];
      this.selectedOptionSig.set([]);
      this.isOptionSelectedSig.set(false);
      this.updateAnsweredState([], this.getFallbackQuestionIndex());
      return;
    }

    const groupedSelections = new Map<number, SelectedOption[]>();

    for (const option of normalizedOptions) {
      const qIndex = option?.questionIndex;

      if (qIndex === undefined || qIndex === null) {
        continue;
      }

      const enrichedOption: SelectedOption = this.idResolver.canonicalizeOptionForQuestion(
        qIndex,
        {
          ...option,
          questionIndex: qIndex,
          selected: true,
          highlight: true,
          showIcon: true
        },
        option.text || (option as any).index
      );

      if (
        enrichedOption?.optionId === undefined ||
        enrichedOption.optionId === null
      ) {
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
      this.saveState();

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
    this.selectedOptionSig.set(combinedSelections);
    this.isOptionSelectedSig.set(combinedSelections.length > 0);
  }

  setSelectedOptionsForQuestion(
    questionIndex: number,
    newSelections: SelectedOption[]
  ): void {
    // Use a composite key to handle options with duplicate IDs but different indices
    const merged = new Map<string, SelectedOption>();

    for (const opt of newSelections ?? []) {
      const optId = opt.optionId;
      const optIdx = opt.displayIndex ?? (opt as any).index ?? -1;
      const key = `${optId}|${optIdx}`;

      if (optId != null) {
        // Respect an explicit selected:false on the input so restore / re-sync
        // paths that pass previously-clicked entries (selected:false, kept for
        // prior-click rendering on refresh) are not silently escalated to
        // currently-selected. Default to true only when the flag is absent,
        // preserving behavior for callers that omit it.
        merged.set(key, {
          ...opt,
          questionIndex,
          selected: opt.selected === false ? false : true
        });
      } else {
      }
    }

    // Single-answer semantics: only the most recent selection is currently
    // selected. Prior entries in newSelections (e.g. from click-path sync
    // that mass-forwards selectedOptionHistory in option-ui-sync.service.ts)
    // represent previously-clicked options that are no longer the active
    // selection. Demote them to selected:false so saveState persists them as
    // "previously clicked" (dark gray prior-click styling on refresh) rather
    // than as currently-selected (white highlight). Multi-answer keeps the
    // input behavior — all accumulated selections remain selected:true.
    if (!this.isMultiAnswerQuestion(questionIndex) && merged.size > 1) {
      const keys = Array.from(merged.keys());
      const lastKey = keys[keys.length - 1];
      for (const k of keys) {
        if (k === lastKey) continue;
        const entry = merged.get(k);
        if (entry) merged.set(k, { ...entry, selected: false });
      }
    }

    // Accumulate selection history for refresh restore (mirrors _wasSelected behavior)
    for (const sel of merged.values()) {
      const history = this._selectionHistory.get(questionIndex) ?? [];
      const alreadyInHistory = history.some(h =>
        h.optionId === sel.optionId
        && h.displayIndex === sel.displayIndex
        && (h.text ?? '') === (sel.text ?? '')
      );
      if (!alreadyInHistory) {
        history.push(sel);
        this._selectionHistory.set(questionIndex, history);
      }
    }

    const committed = this.commitSelections(questionIndex, Array.from(merged.values()));

    // VITAL: Update the live map so getSelectedOptionsForQuestion can see it
    // and saveState can persist it to sessionStorage. Without this, the map
    // stays stale and refresh restore sees M=0.
    if (committed.length > 0) {
      this.selectedOptionsMap.set(questionIndex, committed);
      this.selectedOptionsMapSig.set(new Map(this.selectedOptionsMap));
    }

    // Also store in rawSelectionsMap for results display
    if (committed.length > 0) {
      const rawSelections = committed
        .filter(s => s)
        .map(s => ({
          optionId: typeof s.optionId === 'number' ? s.optionId : -1,
          text: s.text || ''
        }))
        .filter(s => s.optionId >= 0 || s.text);

      this.rawSelectionsMap.set(questionIndex, rawSelections);
    } else {
      this.rawSelectionsMap.delete(questionIndex);
    }
    this.saveState();

    // Sync to QuizService for localStorage persistence
    const ids = committed
      .map((o: any) => o.optionId)
      .filter((id: any): id is number => typeof id === 'number');
    this.quizService.updateUserAnswer(questionIndex, ids);

    // Emit only current question selections
    this.selectedOptionSig.set(committed);

    this.isOptionSelectedSig.set(committed.length > 0);
  }

  setSelectionsForQuestion(qIndex: number, selections: SelectedOption[]): void {
    const committed = this.commitSelections(qIndex, selections);
    this.selectedOptionSig.set(committed);
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
    questionIndex: number
  ): SelectedOption[] {
    const options = this.selectedOptionsMap.get(questionIndex) || [];
    const backup = this._refreshBackup.get(questionIndex) || [];

    const merged = new Map<string, SelectedOption>();
    const keyOf = (o: any) =>
      `${o?.optionId ?? '?'}|${o?.displayIndex ?? o?.index ?? -1}`;

    // 1. Durable sessionStorage FIRST — the cleanest source of truth.
    try {
      const storedStr = sessionStorage.getItem('sel_Q' + questionIndex);
      if (storedStr) {
        const parsed = JSON.parse(storedStr);
        if (Array.isArray(parsed)) {
          for (const o of parsed) {
            if (o) merged.set(keyOf(o), o);
          }
          // Union in _selectionHistory so any prev-clicked entries that were
          // lost from sel_Q* (e.g. an intermediate saveState wrote only the
          // current selection) still surface for the UI. Only add if not
          // already present by composite key.
          const fromHistory = this._selectionHistory.get(questionIndex) ?? [];
          for (const h of fromHistory) {
            if (!h || h.optionId == null) continue;
            if ((h as any).highlight !== true || (h as any).showIcon !== true) continue;
            const k = keyOf(h);
            if (!merged.has(k)) {
              merged.set(k, { ...h, selected: false } as any);
            }
          }
        }
      }
    } catch { /* ignore */ }

    // 2. Fall back to in-memory maps only if sel_Q* had nothing.
    //    During live interaction sel_Q* may not be written yet, so
    //    the in-memory maps are needed.
    if (merged.size === 0) {
      for (const o of backup) if (o) merged.set(keyOf(o), o);
      for (const o of options) if (o) merged.set(keyOf(o), o);
    }

    return Array.from(merged.values());
  }

  public areAllCorrectAnswersSelected(
    question: QuizQuestion,
    selectedOptionIds: Set<number>
  ): boolean {
    return this.answerEval.areAllCorrectAnswersSelected(question, selectedOptionIds);
  }

  clearSelectionsForQuestion(questionIndex: number): void {
    const idx = Number(questionIndex);
    if (!Number.isFinite(idx)) {
      return;
    }

    // Remove from selection and feedback maps
    if (this.selectedOptionsMap.has(idx)) {
      this.selectedOptionsMap.delete(idx);
    }

    this.feedbackState.deleteFeedbackForQuestion(idx);
    this.optionSnapshotByQuestion?.delete(idx);

    // Reset feedback UI if currently on this question
    if (this.quizService?.getCurrentQuestionIndex?.() === idx) {
      this.feedbackState.clearFeedbackSignal();
    }

    // Clear any lingering lock states
    this.lockState.clearLockedOptionsMap(idx);
  }

  // Method to get the current option selected state
  getCurrentOptionSelectedState(): boolean {
    return this.isOptionSelectedSig();
  }

  getShowFeedbackForOption(): { [optionId: number]: boolean } {
    return this.feedbackState.getShowFeedbackForOption();
  }

  getFeedbackForQuestion(questionIndex: number): Record<string, boolean> {
    return this.feedbackState.getFeedbackForQuestion(questionIndex);
  }

  republishFeedbackForQuestion(questionIndex: number): void {
    const selections = this.selectedOptionsMap.get(questionIndex) ?? [];
    this.feedbackState.republishFeedbackForQuestion(
      questionIndex,
      selections,
      this.quizService?.currentQuestionIndex,
      this.isMultiAnswerQuestion(questionIndex)
    );
  }

  private publishFeedbackForQuestion(index: number | null | undefined): void {
    this.feedbackState.publishFeedbackForQuestion(
      index,
      this.quizService?.currentQuestionIndex
    );
  }

  // Method to update the selected option state
  public async selectOption(
    optionId: number,
    questionIndex: number,
    text: string,
    isMultiSelect: boolean,
    optionsSnapshot?: Option[]
  ): Promise<void> {
    if (optionId == null || questionIndex == null || !text) {
      console.error('[SelectedOptionService] Invalid data - EARLY RETURN:', {
        optionId,
        questionIndex,
        text
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
        source.map((option) => ({ ...option }))
      );
    } else {
    }

    const resolved = this.idResolver.resolveOptionFromSource(
      questionIndex,
      optionId,
      text,
      source
    );

    if (!resolved) {
      console.error('[SelectedOptionService] ❌ canonicalOptionId is null - EARLY RETURN', {
        optionId,
        questionIndex,
        text
      });
      return;
    }

    const canonicalOptionId = resolved.canonicalOptionId;
    const foundSourceOption = resolved.foundSourceOption;

    const newSelection: SelectedOption = {
      optionId: canonicalOptionId,  // numeric id if available, else index
      questionIndex,
      text,
      correct: this.idResolver.coerceToBoolean(foundSourceOption?.correct),
      selected: true,
      highlight: true,
      showIcon: true
    };

    const currentSelections = this.selectedOptionsMap.get(questionIndex) || [];
    const canonicalCurrent = this.idResolver.canonicalizeSelectionsForQuestion(
      questionIndex,
      currentSelections
    );
    const filteredSelections = canonicalCurrent.filter(
      (s) =>
        !(
          s.optionId === canonicalOptionId && s.questionIndex === questionIndex
        )
    );
    const updatedSelections = [...filteredSelections, newSelection];
    const committedSelections = this.commitSelections(
      questionIndex,
      updatedSelections
    );

    if (!Array.isArray(this.selectedOptionIndices[questionIndex])) {
      this.selectedOptionIndices[questionIndex] = [];
    }
    if (
      !this.selectedOptionIndices[questionIndex].includes(canonicalOptionId)
    ) {
      this.selectedOptionIndices[questionIndex].push(canonicalOptionId);
    }

    this.selectedOptionSig.set(committedSelections);

    // Emit to isAnsweredSubject so NextButtonStateService enables the button
    this.isAnsweredSig.set(true);

    if (!isMultiSelect) {
      this.isOptionSelectedSig.set(true);
      this.setNextButtonEnabled(true);
    } else {
      const selectedOptions = this.selectedOptionsMap.get(questionIndex) || [];

      // Multi-select: Next button is controlled elsewhere (QQC / QuizComponent)
      if (selectedOptions.length === 0) {
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

    const normId = this.idResolver.normalizeOptionId(option.optionId);
    const normText = this.idResolver.normalizeStr(option.text);
    const normValue = this.idResolver.normalizeStr((option as any)?.value);

    for (const qIndex of indices) {
      const selections = this.selectedOptionsMap.get(qIndex) ?? [];

      const match = selections.some((sel) => {
        if (!sel) return false;
        if (sel.questionIndex !== qIndex) return false;

        const selId = this.idResolver.normalizeOptionId(sel.optionId);
        const selText = this.idResolver.normalizeStr(sel.text);
        const selValue = this.idResolver.normalizeStr((sel as any)?.value);

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
      // Clear all selected options for multiple-answer questions (Question scoped)
      const idx = this.quizService.currentQuestionIndex;
      if (typeof idx === 'number') {
        this.selectedOptionsMap.delete(idx);
        this.feedbackState.deleteFeedbackForQuestion(idx);
        this.optionSnapshotByQuestion.delete(idx);
      } else {
      }
    } else {
      // Clear the single selected option for single-answer questions
      this.selectedOption = [];
      this.selectedOptionSig.set([]);

      const activeIndex = Number.isInteger(
        this.quizService?.currentQuestionIndex,
      )
        ? (this.quizService.currentQuestionIndex as number)
        : null;

      if (activeIndex !== null) {
        this.feedbackState.deleteFeedbackForQuestion(activeIndex);
        this.optionSnapshotByQuestion.delete(activeIndex);
      } else {
        this.feedbackState.clearAll();
        this.optionSnapshotByQuestion.clear();
      }
    }

    // Only clear feedback state here — do NOT touch answered state
    this.feedbackState.clearFeedbackSignal();
  }

  // Resets the internal selection state for the current view, but DOES NOT 
  // wipe persistence/history.
  resetCurrentSelection(): void {
    this.selectedOption = [];
    this.selectedOptionSig.set([]);
  }

  clearOptions(): void {
    this.selectedOptionSig.set([]);
    this.feedbackState.clearAll();
    this.optionSnapshotByQuestion.clear();
  }

  // Observable to get the current option selected state
  isOptionSelected$(): Observable<boolean> {
    return this.selectedOption$.pipe(
      startWith(this.selectedOptionSig()),  // emit the current state immediately when subscribed
      map((option) => option !== null),  // determine if an option is selected
      distinctUntilChanged()  // emit only when the selection state changes
    );
  }

  // Method to set the option selected state
  setOptionSelected(isSelected: boolean): void {
    if (this.isOptionSelectedSig() !== isSelected) {
      this.isOptionSelectedSig.set(isSelected);
    }
  }

  getSelectedOptionIndices(questionIndex: number): number[] {
    const selectedOptions = this.selectedOptionsMap.get(questionIndex) || [];
    return selectedOptions
      .map((option) => option.optionId)
      .filter((id): id is number => id !== undefined);
  }

  addSelectedOptionIndex(questionIndex: number, optionIndex: number): void {
    const options = this.idResolver.canonicalizeSelectionsForQuestion(
      questionIndex,
      this.selectedOptionsMap.get(questionIndex) || []
    );
    const canonicalId = this.idResolver.resolveCanonicalOptionId(
      questionIndex,
      optionIndex
    );
    const existingOption = options.find((o) => o.optionId === canonicalId);

    if (!existingOption) {
      const canonicalOptions = this.idResolver.getKnownOptions(questionIndex);
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
          text: `Option ${optionIndex + 1}`
        };

      const newOption: SelectedOption = {
        ...baseOption,
        optionId: canonicalId ?? baseOption.optionId ?? optionIndex,
        questionIndex,  // ensure the questionIndex is set correctly
        selected: true  // mark as selected since it's being added
      };

      options.push(newOption);  // add the new option
      this.commitSelections(questionIndex, options);  // update the map
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

    const canonicalId = this.idResolver.resolveCanonicalOptionId(
      questionIndex,
      optionIndex
    );
    if (canonicalId == null) {
      return;
    }

    const currentOptions = this.idResolver.canonicalizeSelectionsForQuestion(
      questionIndex,
      this.selectedOptionsMap.get(questionIndex) || []
    );

    const updatedOptions = currentOptions.filter(
      (option) => option.optionId !== canonicalId
    );
    if (updatedOptions.length === currentOptions.length) return;

    this.commitSelections(questionIndex, updatedOptions);
  }

  // Add (and persist) one option for a question
  public addSelection(questionIndex: number, option: SelectedOption): void {
    // Get or initialize the list for this question
    const list = this.idResolver.canonicalizeSelectionsForQuestion(
      questionIndex,
      this.selectedOptionsMap.get(questionIndex) || []
    );
    const canonicalOption = this.idResolver.canonicalizeOptionForQuestion(
      questionIndex,
      option
    );

    if (
      canonicalOption?.optionId === undefined ||
      canonicalOption.optionId === null
    ) {
      return;
    }

    // If this optionId is already in the list, skip
    if (list.some((sel) => sel.optionId === canonicalOption.optionId)) {
      return;
    }

    // Enrich the option object with flags
    const enriched: SelectedOption = {
      ...canonicalOption,
      selected: true,
      showIcon: true,
      highlight: true,
      questionIndex
    };

    // Append and persist
    list.push(enriched);
    const committed = this.commitSelections(questionIndex, list);
  }

  // Method to add or remove a selected option for a question
  public updateSelectionState(
    questionIndex: number,
    selectedOption: SelectedOption,
    isMultiSelect: boolean
  ): void {
    let idx = Number(questionIndex);
    if (!Number.isFinite(idx) || idx < 0) idx = 0;  // pure numeric key

    const prevSelections = this.ensureBucket(idx).map((o) => ({ ...o }));  // clone
    const canonicalSelected = this.idResolver.canonicalizeOptionForQuestion(
      idx,
      selectedOption
    );

    if (canonicalSelected?.optionId == null) {
      return;
    }

    let updatedSelections: SelectedOption[];
    if (isMultiSelect) {
      const already = prevSelections.find(
        (opt) => opt.optionId === canonicalSelected.optionId
      );
      updatedSelections = already
        ? prevSelections
        : [...prevSelections, { ...canonicalSelected }];
    } else {
      updatedSelections = [{ ...canonicalSelected }];  // single-answer: replace
    }

    this.commitSelections(idx, updatedSelections);
  }

  updateSelectedOptions(
    questionIndex: number,
    optionIndex: number,
    action: 'add' | 'remove'
  ): void {
    const canonicalId = this.idResolver.resolveCanonicalOptionId(
      questionIndex,
      optionIndex
    );
    if (canonicalId == null) {
      return;
    }

    const options = this.idResolver.canonicalizeSelectionsForQuestion(
      questionIndex,
      this.selectedOptionsMap.get(questionIndex) || []
    );

    const option = options.find((opt) => opt.optionId === canonicalId);
    if (!option) {
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
    questionIndex: number = -1
  ): void {
    try {
      const resolvedIndex = this.resolveEffectiveQuestionIndex(
        questionIndex,
        questionOptions
      );

      if (resolvedIndex == null || resolvedIndex < 0) {
        console.error(
          '[updateAnsweredState] Unable to resolve a valid question index.',
        );
        return;
      }

      const snapshot = this.buildCanonicalSelectionSnapshot(
        resolvedIndex,
        questionOptions
      );

      if (!Array.isArray(snapshot) || snapshot.length === 0) {
        return;
      }

      const isAnswered = snapshot.some((option) =>
        this.idResolver.coerceToBoolean(option.selected)
      );
      this.isAnsweredSig.set(isAnswered);
    } catch (error) {
      console.error('[updateAnsweredState] Unhandled error:', error);
    }
  }

  private resolveEffectiveQuestionIndex(
    explicitIndex: number,
    questionOptions: Option[]
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
    overrides: Option[]
  ): Option[] {
    return this.idResolver.buildCanonicalSelectionSnapshot(
      questionIndex,
      this.selectedOptionsMap,
      this.quizService
    );
  }

  // ── Delegated to OptionIdResolverService ─────────────────────

  private isMultiAnswerQuestion(questionIndex: number): boolean {
    return this.answerEval.isMultiAnswerQuestion(questionIndex);
  }

  private commitSelections(
    questionIndex: number,
    selections: SelectedOption[]
  ): SelectedOption[] {
    // Always normalize to numeric key
    const idx = Number(questionIndex);
    if (!Number.isFinite(idx) || idx < 0) {
      return [];
    }

    // Canonicalize and deep clone the selections
    const canonicalSelections = this.idResolver.canonicalizeSelectionsForQuestion(
      idx,
      selections
    ).map((sel) => ({ ...sel }));  // ensure new object identity

    // Do NOT force highlight/showIcon here — let calling logic or sync methods decide
    // based on multi-answer rules (e.g. only highlight the last selection).

    if (canonicalSelections.length > 0) {
      // Replace the old bucket completely
      this.selectedOptionsMap.set(idx, canonicalSelections);
    } else {
      this.selectedOptionsMap.delete(idx);
      this.optionSnapshotByQuestion.delete(idx);
    }

    // VITAL: Propagate changes to the reactive map
    this.selectedOptionsMapSig.set(new Map(this.selectedOptionsMap));

    this.syncFeedbackForQuestion(idx, canonicalSelections);

    // Update the "Answered" state whenever selections change.
    // This drives the Next Button enablement.
    this.updateAnsweredState(canonicalSelections, idx);

    // Sync user answers to QuizService
    const ids = canonicalSelections
      .map((o) => o.optionId)
      .filter((id) => id !== null && id !== undefined)
      .map(id => typeof id === 'string' ? parseInt(id, 10) : id as number);

    this.quizService.updateUserAnswer(idx, ids);

    // Store FINAL selections in rawSelectionsMap for reliable results display
    // Use canonicalSelections (the processed final state), not the input
    if (canonicalSelections.length > 0) {
      const rawSelections = canonicalSelections
        .filter(s => s)
        .map(s => ({
          optionId: typeof s.optionId === 'number' ? s.optionId : -1,
          text: s.text || ''
        }))
        .filter(s => s.optionId >= 0 || s.text);

      this.rawSelectionsMap.set(idx, rawSelections);
    } else {
      // Clear when no selections
      this.rawSelectionsMap.delete(idx);
    }

    return canonicalSelections;
  }

  private syncFeedbackForQuestion(
    questionIndex: number,
    selections: SelectedOption[]
  ): void {
    this.feedbackState.syncFeedbackForQuestion(
      questionIndex,
      selections,
      this.quizService?.currentQuestionIndex,
      this.isMultiAnswerQuestion(questionIndex)
    );
  }

  // normalizeQuestionIndex, normalizeStr, resolveOptionIndexFromSelection -> delegated to idResolver

  public isQuestionAnswered(questionIndex: number): boolean {
    const options = this.selectedOptionsMap.get(questionIndex);
    if (Array.isArray(options) && options.length > 0) {
      return true;
    }
    const backup = this._refreshBackup.get(questionIndex);
    return Array.isArray(backup) && backup.length > 0;
  }

  setAnswered(isAnswered: boolean, force = false): void {
    const current = this.isAnsweredSig();
    if (force || current !== isAnswered) {
      this.isAnsweredSig.set(isAnswered);
      sessionStorage.setItem('isAnswered', JSON.stringify(isAnswered));
    } else {
      // Force re-emit even if value didn't change
      this.isAnsweredSig.set(isAnswered);
    }
  }

  setAnsweredState(isAnswered: boolean): void {
    const current = this.isAnsweredSig();

    if (current !== isAnswered) {
      this.isAnsweredSig.set(isAnswered);
    } else {
    }
  }

  getAnsweredState(): boolean {
    return this.isAnsweredSig();
  }

  resetSelectedOption(): void {
    this.isOptionSelectedSig.set(false);
  }

  resetSelectionState(): void {
    this.selectedOptionsMap.clear();
    this.selectedOption = [];
    this.selectedOptionSig.set([]);
    this.feedbackState.clearFeedbackSignal();
    this.isOptionSelectedSig.set(false);
  }

  public resetOptionState(
    questionIndex?: number,
    optionsToDisplay?: Option[]
  ): void {
    try {
      if (typeof questionIndex === 'number') {
        const opts = this.selectedOptionsMap.get(questionIndex) ?? [];
        const cleared = opts.map((o) => ({
          ...o,
          selected: false,
          highlight: false,
          showIcon: false,
          disabled: false
        }));
        this.selectedOptionsMap.set(questionIndex, cleared);
      } else {
        this.selectedOptionsMap.clear();
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
    } catch (error) {
    }
  }

  public resetAllStates(): void {
    try {
      this.selectedOptionsMap.clear();
      this.lockState.clearLockedOptionsMap();
      this.optionStates?.clear?.();
    } catch (error) {
    }
  }

  private getFallbackQuestionIndex(): number {
    const keys = Array.from(this.selectedOptionsMap.keys());
    if (keys.length > 0) {
      return keys[0];
    }
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
    allowEmptySelection = false
  ): void {
    // Defer to ensure setSelectedOption has updated the map this tick
    queueMicrotask(() => {
      const selected = this.selectedOptionsMap.get(questionIndex) ?? [];

      if (allowEmptySelection) {
        // Timer-expiry or external overrides may allow progression without a choice.
        // Preserve the "answered" state while keeping selection tracking honest.
        const anySelected = selected.length > 0;

        this.setAnswered(true);
        this.isOptionSelectedSig.set(anySelected);
        this.nextButtonStateService.setNextButtonState(true);

        return;
      }

      if (!isMultiSelect) {
        // Single → deterministic on first selection
        this.setAnswered(true);  // stream sees answered=true
        this.isOptionSelectedSig.set(true);
        this.nextButtonStateService.setNextButtonState(true);
        return;
      }

      // Multi → enable on ANY selection (your policy)
      const anySelected = selected.length > 0;

      // Tell the stream it's answered so it won’t re-disable the button
      this.setAnswered(anySelected);

      this.isOptionSelectedSig.set(anySelected);
      this.nextButtonStateService.setNextButtonState(anySelected);
    });
  }

  isOptionLocked(qIndex: number, optId: string | number): boolean {
    return this.lockState.isOptionLocked(qIndex, optId);
  }

  lockOption(qIndex: number, optId: string | number): void {
    this.lockState.lockOption(qIndex, optId);
  }

  unlockOption(qIndex: number, optId: string | number): void {
    this.lockState.unlockOption(qIndex, optId);
  }

  unlockAllOptionsForQuestion(qIndex: number): void {
    this.lockState.unlockAllOptionsForQuestion(qIndex);
  }

  lockMany(qIndex: number, optIds: (string | number)[]): void {
    this.lockState.lockMany(qIndex, optIds);
  }

  lockQuestion(qIndex: number): void {
    this.lockState.lockQuestion(qIndex);
  }

  unlockQuestion(qIndex: number): void {
    this.lockState.unlockQuestion(qIndex);
  }

  isQuestionLocked(qIndex: number): boolean {
    return this.lockState.isQuestionLocked(qIndex);
  }

  resetLocksForQuestion(qIndex: number): void {
    this.lockState.resetLocksForQuestion(qIndex);
  }

  public overlaySelectedByIdentity(
    canonical: Option[],
    ui: Option[]
  ): Option[] {
    return this.idResolver.overlaySelectedByIdentity(canonical, ui);
  }

  private ensureBucket(idx: number): SelectedOption[] {
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    if (!this.selectedOptionsMap.has(idx)) this.selectedOptionsMap.set(idx, []);
    return this.selectedOptionsMap.get(idx)!;
  }

  public reapplySelectionForQuestion(option: Option, index: number): void {

    // mark as selected again
    option.selected = true;

    // mark question as answered
    this.setAnswered(true);

    // let your existing pipelines react naturally
  }

  public areAllCorrectAnswersSelectedActiveQuestion(): boolean {
    return this.answerEval.areAllCorrectAnswersSelectedForQuestion(
      this.quizService.currentQuestionIndexSource?.getValue?.() ?? -1,
      (idx) => this.getSelectedOptionsForQuestion(idx),
      this._questionCache
    );
  }

  public storeQuestion(index: number, question: QuizQuestion): void {
    if (question) {
      this._questionCache.set(index, question);
    }
  }

  public isQuestionComplete(
    question: QuizQuestion,
    selected: SelectedOption[]
  ): boolean {
    return this.answerEval.isQuestionComplete(question, selected);
  }

  public isQuestionResolvedCorrectly(
    question: QuizQuestion,
    selected: Array<SelectedOption | Option> | null
  ): boolean {
    return this.answerEval.isQuestionResolvedCorrectly(question, selected);
  }

  public isQuestionResolvedLeniently(
    question: QuizQuestion,
    selected: Array<SelectedOption | Option> | null
  ): boolean {
    return this.answerEval.isQuestionResolvedLeniently(question, selected);
  }

  public isAnyCorrectAnswerSelected(
    question: QuizQuestion,
    selected: Array<SelectedOption | Option> | null
  ): boolean {
    return this.answerEval.isAnyCorrectAnswerSelected(question, selected);
  }

  public getResolutionStatus(
    question: QuizQuestion,
    selected: Option[],
    strict: boolean = false
  ) {
    return this.answerEval.getResolutionStatus(question, selected, strict);
  }

  public getSelectedOptionsForQuestion$(idx: number): Observable<any[]> {
    return this.selectedOptionsMap$.pipe(
      map(() => {
        const normalizedIdx = this.idResolver.normalizeIdx(idx);
        return this.getSelectedOptionsForQuestion(normalizedIdx) ?? [];
      }),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );
  }

  // normalizeIdx -> delegated to idResolver

  clearAllSelectionsForQuiz(quizId: string): void {
    this.selectedOptionsMap.clear();

    this.rawSelectionsMap.clear();
    this.selectedOptionIndices = {};
    this._questionCache.clear();
    this.feedbackState.clearAll();
    this.optionSnapshotByQuestion.clear();
    this.lockState.clearAll();
    this.optionStates.clear();
    this.selectedOption = [];
    this.selectedOptionSig.set([]);
    this.isOptionSelectedSig.set(false);
    this.isAnsweredSig.set(false);

    // Also clear the durable results store for a fresh start
    this.clearAnswersForResults();

    try {
      localStorage.removeItem('selectedOptionsMap');
      localStorage.removeItem('userAnswers');
      localStorage.removeItem('savedQuestionIndex');
      localStorage.removeItem('currentQuestionIndex');
      localStorage.removeItem(`quizState_${quizId}`);
      localStorage.removeItem(`selectedOptions_${quizId}`);
    } catch { }
  }
}