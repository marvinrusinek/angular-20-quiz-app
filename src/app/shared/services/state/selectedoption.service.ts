import { Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { distinctUntilChanged, map, startWith } from 'rxjs/operators';

import { QuestionType } from '../../models/question-type.enum';
import { Option } from '../../models/Option.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { SelectedOption } from '../../models/SelectedOption.model';
import { NextButtonStateService } from './next-button-state.service';
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
  private _refreshBackup = new Map<number, SelectedOption[]>();

  // Accumulates ALL selections per question (including prior single-answer picks)
  // so that _wasSelected-style highlights survive refresh.
  private _selectionHistory = new Map<number, SelectedOption[]>();

  get hasRefreshBackup(): boolean {
    return this._refreshBackup.size > 0;
  }

  getRefreshBackup(idx: number): SelectedOption[] {
    return this._refreshBackup.get(idx) ?? [];
  }

  private scheduleBackupClear(): void {
    setTimeout(() => {
      this._refreshBackup.clear();
    }, 5000);
  }

  private loadState(): void {
    try {
      const raw = sessionStorage.getItem('rawSelectionsMap');
      if (raw) {
        const parsed = JSON.parse(raw);
        this.rawSelectionsMap = new Map(Object.entries(parsed).map(([k, v]) => [Number(k), v as any]));
      }

      const selected = sessionStorage.getItem('selectedOptionsMap');
      if (selected) {
        const parsed = JSON.parse(selected);
        this.selectedOptionsMap = new Map(Object.entries(parsed).map(([k, v]) => [Number(k), v as any]));
        this.selectedOptionsMap$.next(new Map(this.selectedOptionsMap));
      }

      // Load full selection history (includes all single-answer picks)
      const history = sessionStorage.getItem('selectionHistory');
      if (history) {
        const parsed = JSON.parse(history);
        this._refreshBackup = new Map(Object.entries(parsed).map(([k, v]) => [Number(k), v as any]));
      } else if (this.selectedOptionsMap.size > 0) {
        this._refreshBackup = new Map(this.selectedOptionsMap);
      }
      if (this._refreshBackup.size > 0) {
        this.scheduleBackupClear();
      }

      // Detect if this is a page refresh (F5) vs fresh navigation
      const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      const isPageRefresh = navEntries.length > 0 && navEntries[0].type === 'reload';

      if (isPageRefresh) {
        // Determine which question (0-based) the URL is currently on.
        // Only restore/keep state for THAT index — drop everything else
        // so that post-refresh navigation to sibling questions starts
        // fresh (without inheriting stale selections/dot-status that
        // would cause resolveDisplayText to show FET instead of the
        // question text).
        let currentUrlIdx: number | null = null;
        try {
          const match = (window?.location?.pathname ?? '').match(/\/question\/[^/]+\/(\d+)/);
          if (match && match[1]) {
            const oneBased = parseInt(match[1], 10);
            if (Number.isFinite(oneBased) && oneBased >= 1) {
              currentUrlIdx = oneBased - 1;
            }
          }
        } catch { /* ignore */ }

        // Prune in-memory maps restored above (rawSelectionsMap,
        // selectedOptionsMap, _refreshBackup) to the current URL index only.
        // _refreshBackup is consulted by getSelectedOptionsForQuestion and
        // would otherwise leak stale selections for other indices, causing
        // resolveDisplayText to flag them as resolved and show FET.
        if (currentUrlIdx !== null) {
          for (const key of Array.from(this.rawSelectionsMap.keys())) {
            if (key !== currentUrlIdx) this.rawSelectionsMap.delete(key);
          }
          for (const key of Array.from(this.selectedOptionsMap.keys())) {
            if (key !== currentUrlIdx) this.selectedOptionsMap.delete(key);
          }
          for (const key of Array.from(this._refreshBackup.keys())) {
            if (key !== currentUrlIdx) this._refreshBackup.delete(key);
          }
          // Also prune the persisted selectionHistory so a future refresh
          // on another index starts clean.
          try {
            if (this._refreshBackup.size > 0) {
              const historyObj = Object.fromEntries(this._refreshBackup);
              sessionStorage.setItem('selectionHistory', JSON.stringify(historyObj));
            } else {
              sessionStorage.removeItem('selectionHistory');
            }
          } catch { /* ignore */ }
        }

        // Restore clickConfirmedDotStatus from sessionStorage dot_confirmed_* entries.
        // IMPORTANT: preserve dot status for EVERY answered index — not just the
        // current URL index — so the progress bar retains credit for questions
        // answered before the refresh (e.g. Q1 answered, then user refreshes on Q2).
        // Pruning here erases Q1's dot and reverts the progress percentage.
        for (let i = 0; i < 100; i++) {
          const val = sessionStorage.getItem('dot_confirmed_' + i);
          if (val === 'correct' || val === 'wrong') {
            this.clickConfirmedDotStatus.set(i, val);
          }
        }
        // Restore selectedOptionsMap from durable per-question keys
        // (these survive clearState which wipes the main sessionStorage keys)
        for (let i = 0; i < 100; i++) {
          if (currentUrlIdx !== null && i !== currentUrlIdx) {
            // Prune stale per-question selection key for non-current indices.
            sessionStorage.removeItem('sel_Q' + i);
            continue;
          }
          const sel = sessionStorage.getItem('sel_Q' + i);
          if (sel) {
            try {
              const opts = JSON.parse(sel);
              if (Array.isArray(opts) && opts.length > 0) {
                this.selectedOptionsMap.set(i, opts);
              }
            } catch { /* ignore */ }
          }
        }
        if (this.selectedOptionsMap.size > 0) {
          this.selectedOptionsMap$.next(new Map(this.selectedOptionsMap));
          this._refreshBackup = new Map(this.selectedOptionsMap);
        }
      } else {
        // Fresh navigation — clear all stale dot/selection data from sessionStorage
        for (let i = 0; i < 100; i++) {
          sessionStorage.removeItem('dot_confirmed_' + i);
          sessionStorage.removeItem('sel_Q' + i);
        }
        sessionStorage.removeItem('rawSelectionsMap');
        sessionStorage.removeItem('selectedOptionsMap');
        sessionStorage.removeItem('selectionHistory');
        this._refreshBackup.clear();
        this.selectedOptionsMap.clear();
        this.rawSelectionsMap.clear();
      }

    } catch (err) {
      console.warn('[SelectedOptionService] Failed to load state from sessionStorage', err);
    }
  }

  private saveState(): void {
    try {
      const rawObj = Object.fromEntries(this.rawSelectionsMap);
      sessionStorage.setItem('rawSelectionsMap', JSON.stringify(rawObj));

      const selectedObj = Object.fromEntries(this.selectedOptionsMap);
      sessionStorage.setItem('selectedOptionsMap', JSON.stringify(selectedObj));

      // Save full selection history for refresh restore
      if (this._selectionHistory.size > 0) {
        const historyObj = Object.fromEntries(this._selectionHistory);
        sessionStorage.setItem('selectionHistory', JSON.stringify(historyObj));
      }

      // Save to durable per-question keys that survive clearState().
      // MERGE approach: combine all sources (history, map, existing storage)
      // to never lose entries. Uses text as the unique key since optionId
      // resolution can collide for options without explicit IDs.
      const allSources = new Map<number, SelectedOption[]>();
      for (const [idx, opts] of this._selectionHistory) {
        allSources.set(idx, [...(allSources.get(idx) ?? []), ...opts]);
      }
      for (const [idx, opts] of this.selectedOptionsMap) {
        allSources.set(idx, [...(allSources.get(idx) ?? []), ...opts]);
      }
      for (const [idx, combined] of allSources) {
        // Deduplicate by optionId + displayIndex (NOT text — text can collide,
        // be empty, or be undefined, causing the last-clicked entry to be
        // dropped so the highlight never comes back on refresh).
        const seen = new Set<string>();
        const unique: SelectedOption[] = [];
        const keyOf = (sel: any) =>
          `${sel?.optionId ?? '?'}|${sel?.displayIndex ?? sel?.index ?? -1}`;
        for (const sel of combined) {
          if (!sel) continue;
          const key = keyOf(sel);
          if (!seen.has(key)) {
            seen.add(key);
            unique.push(sel);
          }
        }
        // Also merge with what's already in sessionStorage
        const existingRaw = sessionStorage.getItem('sel_Q' + idx);
        if (existingRaw) {
          try {
            const existing = JSON.parse(existingRaw);
            if (Array.isArray(existing)) {
              for (const sel of existing) {
                if (!sel) continue;
                const key = keyOf(sel);
                if (!seen.has(key)) {
                  seen.add(key);
                  unique.push(sel);
                }
              }
            }
          } catch { /* ignore corrupt */ }
        }
        if (unique.length > 0) {
          sessionStorage.setItem('sel_Q' + idx, JSON.stringify(unique));
        }
      }
    } catch (err) {
      console.warn('[SelectedOptionService] Failed to save state to sessionStorage', err);
    }
  }

  public clearState(): void {
    console.log('[SOS] clearState() called - WIPING ALL SELECTIONS from map!');
    this.selectedOptionsMap.clear();
    this.rawSelectionsMap.clear();
    this._selectionHistory.clear();
    this.selectedOption = [];
    this.selectedOptionIndices = {};
    this.feedbackByQuestion.clear();
    this.optionSnapshotByQuestion.clear();
    this._lockedOptionsMap.clear();
    this.optionStates.clear();
    this._questionLocks.clear();
    this._lockedByQuestion.clear();
    this.isAnsweredSubject.next(false);
    this.isOptionSelectedSubject.next(false);
    this.selectedOptionsMap$.next(new Map());
    this.showFeedbackForOptionSubject.next({});

    try {
      sessionStorage.removeItem('rawSelectionsMap');
      sessionStorage.removeItem('selectedOptionsMap');
      sessionStorage.removeItem('selectionHistory');
      sessionStorage.removeItem('answeredMap');
      sessionStorage.removeItem('currentQuestionIndex');
    } catch (err) {
      // ignore
    }
  }

  public resetAllOptions(): void {
    this.clearState();
    this.selectedOptionSubject.next([]);
    this.isOptionSelectedSubject.next(false);
    this.isAnsweredSubject.next(false);
  }

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

  public selectedOptionsMap$ = new BehaviorSubject<Map<number, SelectedOption[]>>(new Map());

  private showFeedbackForOptionSubject = new BehaviorSubject<
    Record<string, boolean>
  >({});
  showFeedbackForOption$ = this.showFeedbackForOptionSubject.asObservable();

  // Signal mirrors for new code; existing $ subscribers unaffected.
  readonly selectedOptionSig = toSignal(this.selectedOption$, { initialValue: [] as SelectedOption[] });
  readonly selectedOptionExplanationSig = toSignal(this.selectedOptionExplanation$, { initialValue: '' });
  readonly isAnsweredSig = toSignal(this.isAnswered$, { initialValue: false });
  readonly questionTextSig = toSignal(this.questionText$, { initialValue: '' });
  readonly showFeedbackForOptionSig = toSignal(this.showFeedbackForOption$, { initialValue: {} as Record<string, boolean> });
  readonly selectedOptionsMapSig = toSignal(this.selectedOptionsMap$, { initialValue: new Map<number, SelectedOption[]>() });

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
    private nextButtonStateService: NextButtonStateService
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
      console.log('[SelectedOptionService] 🧹 Triggering resetAllOptions via QuizService.quizReset$');
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

    // VITAL: Update the map so that getSelectedOptionsForQuestion(index) returns the new state!
    this.selectedOptionsMap.set(questionIndex, committed);
    this.selectedOptionsMap$.next(new Map(this.selectedOptionsMap));

    this.selectedOption = committed;
    this.selectedOptionSubject.next(committed);
    this.isOptionSelectedSubject.next(committed.length > 0);
    this.isAnsweredSubject.next(true);

    // Persist to sessionStorage so data survives navigation
    this.saveState();
  }

  /** Persist a single question's selections to a durable localStorage key
   *  that is NOT cleared by clearState/resetAllOptions/resetAll. */
  private persistAnswerForResults(questionIndex: number, selections: { optionId: number; text: string }[]): void {
    try {
      const key = 'quizAnswersForResults';
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      existing[questionIndex] = selections;
      localStorage.setItem(key, JSON.stringify(existing));
    } catch { /* ignore */ }
  }

  /** Recover all persisted answers from the durable store into rawSelectionsMap. */
  public recoverAnswersForResults(): void {
    try {
      const key = 'quizAnswersForResults';
      const stored = localStorage.getItem(key);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      for (const [k, v] of Object.entries(parsed)) {
        const idx = Number(k);
        if (Number.isFinite(idx) && Array.isArray(v) && v.length > 0) {
          // Only recover if rawSelectionsMap doesn't already have data for this question
          if (!this.rawSelectionsMap.has(idx) || this.rawSelectionsMap.get(idx)!.length === 0) {
            this.rawSelectionsMap.set(idx, v as any);
          }
        }
      }
    } catch { /* ignore */ }
  }

  /** Clear the durable answers store (call only on explicit quiz restart). */
  public clearAnswersForResults(): void {
    try {
      localStorage.removeItem('quizAnswersForResults');
    } catch { /* ignore */ }
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

    // Trust: questionIndex is 0-based (QQC is the source of truth now)
    const idx = Number.isFinite(questionIndex) ? Math.trunc(questionIndex) : -1;
    console.log(`[SOS.addOption] Q${idx + 1} OptionId=${option.optionId} text="${option.text}"`);

    if (idx < 0) {
      console.error('[SOS] Invalid questionIndex passed to addOption:', { questionIndex });
      return;
    }

    // Get existing selections for this question
    const existing = this.selectedOptionsMap.get(idx) ?? [];

    // Canonicalize existing options
    const existingCanonical = this.canonicalizeSelectionsForQuestion(
      idx,
      existing
    );

    const fallbackIdx = (option as any).index ?? (option as any).displayIndex ?? (option as any).idx;
    const newCanonical = this.canonicalizeOptionForQuestion(idx, {
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
    this.selectedOptionSubject.next(committed);
    this.isOptionSelectedSubject.next(committed.length > 0);
  }

  // Removes an option from the selectedOptionsMap
  removeOption(questionIndex: number, optionId: number | string, indexHint?: number): void {
    const canonicalId = this.resolveCanonicalOptionId(questionIndex, optionId, indexHint);
    if (canonicalId == null && indexHint == null) {
      console.warn('[removeOption] Unable to resolve canonical optionId', {
        optionId,
        questionIndex
      });
      return;
    }

    const currentOptions = this.canonicalizeSelectionsForQuestion(
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
      this.selectedOptionSubject.next(committed);
      this.isOptionSelectedSubject.next(committed.length > 0);
      this.updateAnsweredState(committed, questionIndex);
    } else {
      this.selectedOptionsMap.delete(questionIndex);

      if (this.quizService) {
        this.quizService.updateUserAnswer(questionIndex, []);
      }

      this.selectedOption = [];
      this.selectedOptionSubject.next([]);
      this.isOptionSelectedSubject.next(false);
      this.setAnswered(false, true); // Update answered state
      this.setNextButtonEnabled(false); // Explicitly disable next button
    }
    this.saveState();
  }

  setNextButtonEnabled(enabled: boolean): void {
    this.isNextButtonEnabledSubject.next(enabled);  // update the button's enabled state
  }

  clearSelection(): void {
    this.isOptionSelectedSubject.next(false);  // no option selected
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

    // Canonical selection state
    this.selectedOptionsMap.set(idx, []);
    this.selectedOptionIndices[idx] = [];

    // Snapshot used by correctness logic
    this.optionSnapshotByQuestion.delete(idx);

    // Timer / correctness flags
    this.stopTimerEmitted = false;

    // Emit clean state so UI updates
    try {
      this.selectedOptionSubject.next([]);
    } catch { }

    try {
      this.isOptionSelectedSubject.next(false);
    } catch { }

    this.saveState();
    console.log('[SelectedOptionService] Cleared all selections for Q', idx);
  }

  setSelectedOption(
    option: SelectedOption | null,
    questionIndex?: number,
    optionsSnapshot?: Option[],
    isMultipleAnswer?: boolean
  ): void {
    if (!option) {
      if (questionIndex == null) {
        console.warn(
          '[setSelectedOption] null option with no questionIndex — ignoring'
        );
        return;
      }

      console.log(
        `[setSelectedOption] Clearing selections for Q${questionIndex}`
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
        questionIndex
      });
      return;
    }

    // Populate snapshot if provided
    if (optionsSnapshot && optionsSnapshot.length > 0) {
      console.log(
        `[setSelectedOption] 📸 Setting snapshot for Q${questionIndex} with ${optionsSnapshot.length} options.`
      );
      this.optionSnapshotByQuestion.set(qIndex, optionsSnapshot);
    } else {
      console.log(
        `[setSelectedOption] ⚠️ No snapshot provided for Q${questionIndex}.`
      );
    }

    const enriched: SelectedOption = this.canonicalizeOptionForQuestion(
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
      console.warn(
        '[LOCKDOWN] Clearing previous selections for single-answer question',
        qIndex
      );
      this.selectedOptionsMap.set(qIndex, []);
    }

    const current = this.selectedOptionsMap.get(qIndex) || [];
    let canonicalCurrent = this.canonicalizeSelectionsForQuestion(
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
          '[setSelectedOptions] Missing questionIndex on option', option
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
          showIcon: true
        },
        option.text || (option as any).index
      );

      if (
        enrichedOption?.optionId === undefined ||
        enrichedOption.optionId === null
      ) {
        console.warn(
          '[setSelectedOptions] Unable to resolve canonical optionId',
          {
            option,
            questionIndex: qIndex
          }
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
    this.selectedOptionSubject.next(combinedSelections);
    this.isOptionSelectedSubject.next(combinedSelections.length > 0);
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
        merged.set(key, {
          ...opt,
          questionIndex,
          selected: true
        });
      } else {
        console.warn('[SOS] Skipping option with invalid optionId', opt);
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
      this.selectedOptionsMap$.next(new Map(this.selectedOptionsMap));
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

    console.log(`[SOS] setSelectedOptionsForQuestion Q${questionIndex} syncing IDs:`, ids);
    this.quizService.updateUserAnswer(questionIndex, ids);

    // Emit only current question selections
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
    questionIndex: number
  ): SelectedOption[] {
    const options = this.selectedOptionsMap.get(questionIndex) || [];
    const backup = this._refreshBackup.get(questionIndex) || [];

    // During the refresh window, UNION map + backup + durable sel_Q key.
    // The map comes from sel_Q* (text-dedup'd in saveState) while backup
    // comes from _selectionHistory (raw). If the text-dedup dropped the
    // last-clicked entry, the backup still has it. Merging both ensures
    // no click is lost on rehydrate.
    if (this._refreshBackup.size > 0) {
      const merged = new Map<string, SelectedOption>();
      const keyOf = (o: any) =>
        `${o?.optionId ?? '?'}|${o?.displayIndex ?? o?.index ?? -1}`;
      for (const o of options) if (o) merged.set(keyOf(o), o);
      for (const o of backup) if (o && !merged.has(keyOf(o))) merged.set(keyOf(o), o);
      try {
        const sel = sessionStorage.getItem('sel_Q' + questionIndex);
        if (sel) {
          const parsed = JSON.parse(sel);
          if (Array.isArray(parsed)) {
            for (const o of parsed) if (o && !merged.has(keyOf(o))) merged.set(keyOf(o), o);
          }
        }
      } catch { /* ignore */ }
      if (merged.size > 0) return Array.from(merged.values());
    }

    if (options.length > 0) return options;
    if (backup.length > 0) return backup;
    return [];
  }

  public areAllCorrectAnswersSelected(
    question: QuizQuestion,
    selectedOptionIds: Set<number>
  ): boolean {
    // Only get CORRECT option IDs, not ALL options
    const correctIds = question.options
      .filter(o => {
        const c = (o as any).correct;
        return c === true || String(c) === 'true' || c === 1 || c === '1';
      })  // filter for correct options first
      .map(o => o.optionId)
      .filter((id): id is number => typeof id === 'number');

    console.log('[areAllCorrectAnswersSelected] correctIds:', correctIds,
      'selectedIds:', Array.from(selectedOptionIds));

    if (correctIds.length === 0) return false;

    // Convert Set<number> to Set<string> for robust comparison
    const selectedStrings = new Set(Array.from(selectedOptionIds).map(id => String(id)));

    for (const id of correctIds) {
      if (!selectedStrings.has(String(id))) {
        return false;
      }
    }

    return true;
  }

  clearSelectionsForQuestion(questionIndex: number): void {
    const idx = Number(questionIndex);
    if (!Number.isFinite(idx)) {
      console.warn(
        `[clearSelectionsForQuestion] Invalid index:`, questionIndex
      );
      return;
    }

    // Remove from selection and feedback maps
    if (this.selectedOptionsMap.has(idx)) {
      this.selectedOptionsMap.delete(idx);
    }

    this.feedbackByQuestion.delete(idx);
    this.optionSnapshotByQuestion?.delete(idx);

    // Reset feedback UI if currently on this question
    if (this.quizService?.getCurrentQuestionIndex?.() === idx) {
      this.showFeedbackForOptionSubject.next({});
    }

    // Clear any lingering lock states
    try {
      (this as any)._lockedOptionsMap?.delete(idx);
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
      console.warn(
        `[SelectedOptionService] No options source available for snapshot Q${questionIndex + 1}`
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
      if (typeof v === 'number' && Number.isFinite(v)) return v;  // 0 allowed
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
      'html'
    ];

    const directMatch = this.matchOptionFromSource(
      source,
      optionId,
      text,
      aliasFields
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

    // Prefer a concrete index hint (from id or text) over raw text
    const resolverHint: number | string | undefined =
      indexFromId >= 0
        ? indexFromId
        : fallbackIndexFromText >= 0
          ? fallbackIndexFromText
          : (directMatch?.index ?? text);

    let canonicalOptionId = this.resolveCanonicalOptionId(
      questionIndex,
      optionId,
      resolverHint
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
            indexFromId
          }
        );
        canonicalOptionId = indexFromId;
      } else if (fallbackIndexFromText >= 0) {
        console.warn(
          '[SelectedOptionService] Resolver missed; using snapshot fallbackIndexFromText',
          {
            questionIndex,
            optionId,
            text,
            fallbackIndexFromText
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
              resolved
            }
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
          displayText: o?.displayText
        }))
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
      optionId: canonicalOptionId,  // numeric id if available, else index
      questionIndex,
      text,
      correct: this.coerceToBoolean(foundSourceOption?.correct),
      selected: true,
      highlight: true,
      showIcon: true
    };

    const currentSelections = this.selectedOptionsMap.get(questionIndex) || [];
    const canonicalCurrent = this.canonicalizeSelectionsForQuestion(
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

    this.selectedOptionSubject.next(committedSelections);

    // Emit to isAnsweredSubject so NextButtonStateService enables the button
    this.isAnsweredSubject.next(true);
    console.log('[SelectedOptionService] isAnsweredSubject emitted TRUE');

    if (!isMultiSelect) {
      this.isOptionSelectedSubject.next(true);
      this.setNextButtonEnabled(true);
    } else {
      const selectedOptions = this.selectedOptionsMap.get(questionIndex) || [];

      // Multi-select: Next button is controlled elsewhere (QQC / QuizComponent)
      if (selectedOptions.length === 0) {
        console.warn('[No selected options found for multi-select]');
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
      // Clear all selected options for multiple-answer questions (Question scoped)
      const idx = this.quizService.currentQuestionIndex;
      if (typeof idx === 'number') {
        this.selectedOptionsMap.delete(idx);
        this.feedbackByQuestion.delete(idx);
        this.optionSnapshotByQuestion.delete(idx);
      } else {
        console.warn('[SOS] clearSelectedOption: No valid index to delete');
      }
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

  // Resets the internal selection state for the current view, but DOES NOT 
  // wipe persistence/history.
  resetCurrentSelection(): void {
    this.selectedOption = [];
    this.selectedOptionSubject.next([]);
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
      startWith(this.selectedOptionSubject.getValue()),  // emit the current state immediately when subscribed
      map((option) => option !== null),  // determine if an option is selected
      distinctUntilChanged()  // emit only when the selection state changes
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
      this.selectedOptionsMap.get(questionIndex) || []
    );
    const canonicalId = this.resolveCanonicalOptionId(
      questionIndex,
      optionIndex
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

    const canonicalId = this.resolveCanonicalOptionId(
      questionIndex,
      optionIndex
    );
    if (canonicalId == null) {
      console.warn(
        '[removeSelectedOptionIndex] Unable to resolve canonical optionId',
        {
          optionIndex,
          questionIndex
        }
      );
      return;
    }

    const currentOptions = this.canonicalizeSelectionsForQuestion(
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
    const list = this.canonicalizeSelectionsForQuestion(
      questionIndex,
      this.selectedOptionsMap.get(questionIndex) || []
    );
    const canonicalOption = this.canonicalizeOptionForQuestion(
      questionIndex,
      option
    );

    if (
      canonicalOption?.optionId === undefined ||
      canonicalOption.optionId === null
    ) {
      console.warn('[addSelection] Unable to resolve canonical optionId', {
        option,
        questionIndex
      });
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
    const canonicalSelected = this.canonicalizeOptionForQuestion(
      idx,
      selectedOption
    );

    if (canonicalSelected?.optionId == null) {
      console.warn(
        '[updateSelectionState] Unable to resolve canonical optionId',
        { questionIndex, selectedOption }
      );
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
    const canonicalId = this.resolveCanonicalOptionId(
      questionIndex,
      optionIndex
    );
    if (canonicalId == null) {
      console.warn(
        '[updateSelectedOptions] Unable to resolve canonical optionId',
        {
          optionIndex,
          questionIndex,
          action
        }
      );
      return;
    }

    const options = this.canonicalizeSelectionsForQuestion(
      questionIndex,
      this.selectedOptionsMap.get(questionIndex) || []
    );

    const option = options.find((opt) => opt.optionId === canonicalId);
    if (!option) {
      console.warn(
        `[updateSelectedOptions] Option not found for optionIndex: ${optionIndex}`
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
        console.warn(
          '[updateAnsweredState] No option snapshot available for evaluation.'
        );
        return;
      }

      const isAnswered = snapshot.some((option) =>
        this.coerceToBoolean(option.selected)
      );
      this.isAnsweredSubject.next(isAnswered);
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
    const canonicalOptions = this.getKnownOptions(questionIndex);

    const normalizedOverrides = Array.isArray(overrides)
      ? overrides.filter(Boolean)
      : [];
    const mapSelections = this.canonicalizeSelectionsForQuestion(
      questionIndex,
      this.selectedOptionsMap.get(questionIndex) || []
    );

    const overlaySelections = new Map<number, Option>();

    const recordSelection = (option: Option, fallbackIdx?: number): void => {
      if (!option) {
        return;
      }

      const resolvedIdx = this.resolveOptionIndexFromSelection(
        canonicalOptions,
        option
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
          (overlay as Option)?.correct ?? option?.correct
        ),
        selected: this.coerceToBoolean(
          (overlay as Option)?.selected ?? option?.selected
        )
      };
    });
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
    aliasFields: string[]
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
        canonical.map((option) => ({ ...option }))
      );
      return canonical;
    }

    const snapshot = this.optionSnapshotByQuestion.get(questionIndex);
    return Array.isArray(snapshot) ? snapshot : [];
  }

  private resolveCanonicalOptionId(
    questionIndex: number,
    rawId: number | string | null | undefined,
    fallbackIndexOrText?: number | string
  ): number | null {
    const toFiniteNumber = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value !== -1 ? value : null;
      }

      const parsed = Number(String(value));
      return (Number.isFinite(parsed) && parsed !== -1) ? parsed : null;
    };

    const parseFallbackNumber = (): number | null => {
      const rawNumeric = toFiniteNumber(rawId);
      if (rawNumeric !== null) {
        // Detect Synthetic IDs: (QuestionIndex + 1) * 100 + (OptionIndex + 1)
        // If rawNumeric looks synthetic for THIS question, treat it as null/invalid
        // to force downstream logic (matchOptionFromSource) to fallback to Text Matching.
        if (rawNumeric > 100) {
          const syntheticQIdx = Math.floor(rawNumeric / 100) - 1;
          if (syntheticQIdx === questionIndex) {
            return null;
          }
        }
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
      return (numericId !== null && numericId !== -1) ? numericId : index;
    };

    const aliasFields = [
      'text',
      'value',
      'label',
      'name',
      'title',
      'displayText',
      'html',
      'description'
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
      if (option?.optionId !== null && option?.optionId !== undefined && String(option.optionId) !== '-1') {
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
    fallbackIndex?: number | string
  ): SelectedOption {
    if (!option) {
      return option;
    }

    const canonicalId = this.resolveCanonicalOptionId(
      questionIndex,
      option.optionId,
      fallbackIndex
    );

    if (canonicalId === null || canonicalId === option.optionId) {
      return option;
    }

    return {
      ...option,
      optionId: canonicalId
    };
  }

  private canonicalizeSelectionsForQuestion(
    questionIndex: number,
    selections: SelectedOption[]
  ): SelectedOption[] {
    const canonical: SelectedOption[] = [];
    const seenKeys = new Set<string>();

    for (const selection of selections ?? []) {
      if (!selection) {
        continue;
      }

      const canonicalSelection = this.canonicalizeOptionForQuestion(
        questionIndex,
        selection,
        selection.text || (selection as any).index || selection.displayIndex
      );

      if (
        canonicalSelection?.optionId === undefined ||
        canonicalSelection.optionId === null
      ) {
        continue;
      }

      const key = `${canonicalSelection.optionId}|${canonicalSelection.displayIndex ?? (selection as any).index ?? -1}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      canonical.push(canonicalSelection);
    }

    return canonical;
  }

  private isMultiAnswerQuestion(questionIndex: number): boolean {
    const q = this.quizService.questions[questionIndex];
    if (!q) return false;
    if (q.type === QuestionType.MultipleAnswer) return true;

    // Fallback: check count of correct options
    const correctAnswersCount = (q.options ?? []).filter(
      (option: Option) => option.correct === true || String(option.correct) === 'true',
    ).length;
    return correctAnswersCount > 1;
  }

  private commitSelections(
    questionIndex: number,
    selections: SelectedOption[]
  ): SelectedOption[] {
    // Always normalize to numeric key
    const idx = Number(questionIndex);
    if (!Number.isFinite(idx) || idx < 0) {
      console.warn(
        `[commitSelections] ⚠️ Invalid question index: ${questionIndex}`
      );
      return [];
    }

    // Canonicalize and deep clone the selections
    const canonicalSelections = this.canonicalizeSelectionsForQuestion(
      idx,
      selections
    ).map((sel) => ({ ...sel }));  // ensure new object identity

    // Do NOT force highlight/showIcon here — let calling logic or sync methods decide
    // based on multi-answer rules (e.g. only highlight the last selection).

    console.log(`[SOS] commitSelections for Q${idx + 1}: count=${canonicalSelections.length}`);

    if (canonicalSelections.length > 0) {
      // Replace the old bucket completely
      this.selectedOptionsMap.set(idx, canonicalSelections);
    } else {
      this.selectedOptionsMap.delete(idx);
      this.optionSnapshotByQuestion.delete(idx);
    }

    // VITAL: Propagate changes to the reactive map
    this.selectedOptionsMap$.next(new Map(this.selectedOptionsMap));

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
    selections: SelectedOption[]
  ): Record<string, boolean> {
    const feedbackMap: Record<string, boolean> = {};

    const targetSelections = this.isMultiAnswerQuestion(questionIndex) && selections.length > 0
      ? [selections[selections.length - 1]]
      : selections;

    for (const selection of targetSelections ?? []) {
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
    selection: SelectedOption
  ): Array<string | number> {
    const keys = new Set<string | number>();

    const normalizedSelectionId = this.normalizeOptionId(selection.optionId);
    if (normalizedSelectionId && String(normalizedSelectionId) !== '-1') {
      keys.add(normalizedSelectionId);
    }

    const numericSelectionId = this.extractNumericId(selection.optionId);
    if (numericSelectionId !== null && String(numericSelectionId) !== '-1') {
      keys.add(numericSelectionId);
    }

    if (selection.optionId !== undefined && selection.optionId !== null && String(selection.optionId) !== '-1') {
      keys.add(selection.optionId);
    }

    const options = this.getKnownOptions(questionIndex);
    if (options.length > 0) {
      const resolvedIndex = this.resolveOptionIndexFromSelection(
        options,
        selection
      );

      if (
        resolvedIndex !== null &&
        resolvedIndex >= 0 &&
        resolvedIndex < options.length
      ) {
        const option: any = options[resolvedIndex];

        const normalizedOptionId = this.normalizeOptionId(option?.optionId);
        if (normalizedOptionId && String(normalizedOptionId) !== '-1') {
          keys.add(normalizedOptionId);
        }

        const numericOptionId = this.extractNumericId(option?.optionId);
        if (numericOptionId !== null && String(numericOptionId) !== '-1') {
          keys.add(numericOptionId);
        }

        if (option?.optionId !== undefined && option?.optionId !== null && String(option.optionId) !== '-1') {
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

  private normalizeStr(x: unknown): string {
    return typeof x === 'string'
      ? x.trim().toLowerCase().replace(/\s+/g, ' ')
      : '';
  }

  private resolveOptionIndexFromSelection(
    options: Option[],
    selection: any
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

    // 0) Prioritize explicit index/idx if provided
    const explicitIndex = selection?.index ?? selection?.idx;
    if (explicitIndex !== undefined && explicitIndex !== null && Number.isFinite(explicitIndex)) {
      const n = Number(explicitIndex);
      if (n >= 0 && n < options.length) return n;
    }

    // 1) Strict id match (accept 0, skip -1)
    if (
      'optionId' in selection &&
      selection.optionId !== null &&
      selection.optionId !== undefined &&
      String(selection.optionId) !== '-1'
    ) {
      const hit = byId.get(selection.optionId);
      if (hit !== undefined) return hit;
    }
    if (
      'id' in selection &&
      selection.id !== null &&
      selection.id !== undefined &&
      String(selection.id) !== '-1'
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
      'Unable to determine a canonical optionId for selection', selection
    );
    return null;
  }

  public isQuestionAnswered(questionIndex: number): boolean {
    const options = this.selectedOptionsMap.get(questionIndex);
    if (Array.isArray(options) && options.length > 0) {
      return true;
    }
    const backup = this._refreshBackup.get(questionIndex);
    return Array.isArray(backup) && backup.length > 0;
  }

  setAnswered(isAnswered: boolean, force = false): void {
    const current = this.isAnsweredSubject.getValue();
    if (force || current !== isAnswered) {
      console.log('[EMIT CHECK] About to emit answered:', isAnswered);
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
        '[setAnsweredState] No change needed (already', current + ')'
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
    console.log('[Selection state fully reset]');
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
        console.log(
          `[SelectedOptionService] 🔄 Reset options for question ${questionIndex}`
        );
      } else {
        this.selectedOptionsMap.clear();
        console.log(
          '[SelectedOptionService] Reset options for ALL questions'
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
    } catch (error) {
      console.warn('[SelectedOptionService] resetOptionState failed:', error);
    }
  }

  public resetAllStates(): void {
    try {
      this.selectedOptionsMap.clear();
      this._lockedOptionsMap?.clear?.();
      this.optionStates?.clear?.();
      console.log(
        '[SelectedOptionService] Cleared all selection/lock state',
      );
    } catch (error) {
      console.warn('[SelectedOptionService] resetAllStates failed', error);
    }
  }

  private getFallbackQuestionIndex(): number {
    const keys = Array.from(this.selectedOptionsMap.keys());
    if (keys.length > 0) {
      console.log(
        '[getFallbackQuestionIndex] Using fallback index from selectedOptionsMap:',
        keys[0]
      );
      return keys[0];
    }

    console.info(
      '[getFallbackQuestionIndex] No keys found in selectedOptionsMap. Unable to infer fallback question index.'
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
        this.isOptionSelectedSubject.next(anySelected);
        this.nextButtonStateService.setNextButtonState(true);

        console.log('[Next Enabled] Override allowing empty selection', {
          questionIndex,
          anySelected
        });

        return;
      }

      if (!isMultiSelect) {
        // Single → deterministic on first selection
        this.setAnswered(true);  // stream sees answered=true
        this.isOptionSelectedSubject.next(true);
        this.nextButtonStateService.setNextButtonState(true);
        console.log('[Next Enabled] Single → first selection');
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
          : '[⛔ Multi] none selected → Next disabled'
      );
    });
  }

  isOptionLocked(qIndex: number, optId: string | number): boolean {
    return this._lockedByQuestion.get(qIndex)?.has(String(optId)) ?? false;
  }

  lockOption(qIndex: number, optId: string | number): void {
    let set = this._lockedByQuestion.get(qIndex);
    if (!set) {
      set = new Set<string | number>();
      this._lockedByQuestion.set(qIndex, set);
    }
    set.add(String(optId));
  }

  unlockOption(qIndex: number, optId: string | number): void {
    const set = this._lockedByQuestion.get(qIndex);
    if (set) {
      set.delete(String(optId));
    }
  }

  unlockAllOptionsForQuestion(qIndex: number): void {
    this._lockedByQuestion.delete(qIndex);
  }

  lockMany(qIndex: number, optIds: (string | number)[]): void {
    let set = this._lockedByQuestion.get(qIndex);
    if (!set) {
      set = new Set<string | number>();
      this._lockedByQuestion.set(qIndex, set);
    }
    for (const id of optIds) {
      set!.add(String(id));
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
    cb: (canonIndex: number, uiItem: Option) => void
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

  // Keep overlay (pure, returns a snapshot)
  public overlaySelectedByIdentity(
    canonical: Option[],
    ui: Option[]
  ): Option[] {
    if (!Array.isArray(canonical) || canonical.length === 0) return [];
    const out = canonical.map((o) => ({ ...o, selected: false }));

    this.forEachUiMatch(canonical, ui, (i, u) => {
      out[i].selected = !!(u as any).selected;
    });

    return out;
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

      const correctOptions = question.options.filter((o: any) => {
        const c = o.correct;
        return c === true || String(c) === 'true' || c === 1 || c === '1';
      });
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
    selected: SelectedOption[]
  ): boolean {
    if (!question || !Array.isArray(question.options)) return false;

    // Verify using 'correct' boolean flag on the selected objects directly.
    // This avoids all ID mismatch issues (string vs number vs undefined).

    // 1. Must have selected at least one option
    if (!selected || selected.length === 0) return false;

    // 2. Identify total expected correct options
    const totalCorrect = question.options.filter((o: any) => {
      const c = o.correct;
      return c === true || String(c) === 'true' || c === 1 || c === '1';
    }).length;
    if (totalCorrect === 0) return false;

    // 3. Count how many of the SELECTED options are actually correct.
    // robust verification by looking up in the source 'question.options'
    const selectedCorrectCount = selected.filter(sel => {
      // A. Trusted flag (if available)
      const c = (sel as any).correct;
      if (c === true || String(c) === 'true' || c === 1 || c === '1') return true;

      const selIdStr = String(sel.optionId);

      // B. ID Match
      const matchById = question.options.find(o =>
        (o.optionId !== undefined && o.optionId !== null) && String(o.optionId) === selIdStr
      );
      if (matchById) return !!matchById.correct;

      // C. Index Fallback (for quizzes without IDs)
      // Assume optionId is 1-based index
      const numericId = Number(sel.optionId);
      if (Number.isInteger(numericId)) {
        const index = numericId - 1;
        if (index >= 0 && index < question.options.length) {
          // Only use index if the target option doesn't have an explicit conflicting ID
          const target = question.options[index];
          if (target.optionId === undefined || target.optionId === null) {
            return !!target.correct;
          }
        }
      }
      return false;
    }).length;

    const selectedIncorrectCount = selected.length - selectedCorrectCount;

    return selectedCorrectCount === totalCorrect && selectedIncorrectCount === 0;
  }

  public isQuestionResolvedCorrectly(
    question: QuizQuestion,
    selected: Array<SelectedOption | Option> | null
  ): boolean {
    return this.getResolutionStatus(question, selected as Option[], true).resolved;
  }

  public isQuestionResolvedLeniently(
    question: QuizQuestion,
    selected: Array<SelectedOption | Option> | null
  ): boolean {
    return this.getResolutionStatus(question, selected as Option[], false).resolved;
  }

  public isAnyCorrectAnswerSelected(
    question: QuizQuestion,
    selected: Array<SelectedOption | Option> | null
  ): boolean {
    const status = this.getResolutionStatus(question, selected as Option[], false);
    return status.correctSelected > 0;
  }

  public getResolutionStatus(
    question: QuizQuestion,
    selected: Option[],
    strict: boolean = false
  ): {
    resolved: boolean;
    correctTotal: number;
    correctSelected: number;
    incorrectSelected: number;
    remainingCorrect: number;
  } {
    if (!question) {
      return { resolved: false, correctTotal: 0, correctSelected: 0, incorrectSelected: 0, remainingCorrect: 0 };
    }

    const questionOptions = Array.isArray(question.options) ? question.options : [];
    const correctTotal = questionOptions.filter(o => this.coerceToBoolean(o.correct)).length;

    let correctSelected = 0;
    let incorrectSelected = 0;

    const selectedArr = Array.isArray(selected) ? selected : [];
    const seenIndicesInQuestion = new Set<number>();

    // Detect whether question options have real IDs (from JSON) or not
    const hasRealIds = questionOptions.some(o => o.optionId != null);

    console.log(`[RESOLUTION_TRACE] Q: "${question.questionText?.substring(0, 50)}..." | totalCorrect=${correctTotal} | selections=${selectedArr.length} | hasRealIds=${hasRealIds}`);

    for (const sel of selectedArr) {
      if (!sel) continue;

      let matchedIdx = -1;
      let matchMethod = 'none';

      // STRATEGY 1: TEXT MATCH (most reliable — works regardless of ID normalization)
      if (sel.text) {
        const selText = sel.text.trim().toLowerCase();
        matchedIdx = questionOptions.findIndex(o =>
          o.text && o.text.trim().toLowerCase() === selText
        );
        if (matchedIdx !== -1) matchMethod = 'text';
      }

      // STRATEGY 2: ID MATCH (only reliable when question options have real IDs)
      if (matchedIdx === -1 && sel.optionId != null && hasRealIds) {
        const selIdStr = String(sel.optionId);
        matchedIdx = questionOptions.findIndex(o =>
          o.optionId != null && String(o.optionId) === selIdStr
        );
        if (matchedIdx !== -1) matchMethod = 'id';
      }

      // STRATEGY 3: Synthetic ID Modulo (e.g. 201 -> index 0)
      if (matchedIdx === -1 && typeof sel.optionId === 'number' && sel.optionId > 100) {
        const potentialIdx = (sel.optionId % 100) - 1;
        if (potentialIdx >= 0 && potentialIdx < questionOptions.length) {
          matchedIdx = potentialIdx;
          matchMethod = 'synthetic_id';
        }
      }

      // STRATEGY 4: Explicit index fallback
      if (matchedIdx === -1 && typeof (sel as any).index === 'number') {
        const idx = (sel as any).index;
        if (idx >= 0 && idx < questionOptions.length) {
          matchedIdx = idx;
          matchMethod = 'index';
        }
      }

      if (matchedIdx !== -1) {
        if (seenIndicesInQuestion.has(matchedIdx)) continue;
        seenIndicesInQuestion.add(matchedIdx);

        const isCorrect = this.coerceToBoolean(questionOptions[matchedIdx].correct);
        if (isCorrect) {
          correctSelected++;
          console.log(`  ✅ "${sel.text?.substring(0, 25)}" -> Q[${matchedIdx}] via ${matchMethod} = CORRECT`);
        } else {
          incorrectSelected++;
          console.log(`  ❌ "${sel.text?.substring(0, 25)}" -> Q[${matchedIdx}] via ${matchMethod} = INCORRECT`);
        }
      } else {
        // Last resort: trust the selection's own correct flag
        if (this.coerceToBoolean(sel.correct)) {
          correctSelected++;
          console.log(`  ⚠️ "${sel.text?.substring(0, 25)}" no Q-match, using sel.correct=true`);
        } else {
          incorrectSelected++;
          console.log(`  ❓ "${sel.text?.substring(0, 25)}" no Q-match, assuming INCORRECT`);
        }
      }
    }

    const remainingCorrect = Math.max(correctTotal - correctSelected, 0);
    let resolved = correctTotal > 0 && remainingCorrect === 0;

    if (strict) {
      resolved = resolved && incorrectSelected === 0;
    }

    console.log(`[RESOLUTION_TRACE] RESULT: correct=${correctSelected}/${correctTotal}, incorrect=${incorrectSelected}, strict=${strict} -> RESOLVED=${resolved}`);

    return { resolved, correctTotal, correctSelected, incorrectSelected, remainingCorrect };
  }

  public getSelectedOptionsForQuestion$(idx: number): Observable<any[]> {
    return this.selectedOptionsMap$.pipe(
      map(() => {
        const normalizedIdx = this.normalizeIdx(idx);
        return this.getSelectedOptionsForQuestion(normalizedIdx) ?? [];
      }),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );
  }

  private normalizeIdx(idx: number): number {
    if (!Number.isFinite(idx)) return -1;

    const n = Math.trunc(idx);

    // Most of your app uses 0-based indices already.
    // Only convert to 0-based when we can *prove* it's 1-based.
    const qs = this.quizService?.questions;

    if (Array.isArray(qs) && qs.length > 0) {
      const len = qs.length;

      // If idx is out of bounds but idx-1 is valid, assume 1-based.
      // Example: len=6 and caller passes 6 (meaning Q6) -> convert to 5.
      if (n >= len && n - 1 >= 0 && n - 1 < len) return n - 1;

      // REMOVED: Dangerous logic that shifts index if current is null.
      // This caused Q3 (idx 2) to resolve as Q2 (idx 1) when Q3 data was loading.
      return n;
    }

    // If we don't know questions length yet (cold start), DON'T guess.
    return n;
  }

  clearAllSelectionsForQuiz(quizId: string): void {
    this.selectedOptionsMap.clear();

    this.rawSelectionsMap.clear();
    this.selectedOptionIndices = {};
    this._questionCache.clear();
    this.feedbackByQuestion.clear();
    this.optionSnapshotByQuestion.clear();
    this._lockedByQuestion.clear();
    this._questionLocks.clear();
    this._lockedOptionsMap.clear();
    this.optionStates.clear();
    this.selectedOption = [];
    this.selectedOptionSubject.next([]);
    this.isOptionSelectedSubject.next(false);
    this.isAnsweredSubject.next(false);

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