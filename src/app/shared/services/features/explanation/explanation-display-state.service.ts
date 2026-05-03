import { Injectable, Injector, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  BehaviorSubject, firstValueFrom, merge, Observable, ReplaySubject, Subject
} from 'rxjs';
import {
  distinctUntilChanged, filter, map, startWith, take, timeout
} from 'rxjs/operators';

import { QuizQuestion } from '../../../models/QuizQuestion.model';
import { QuizService } from '../../data/quiz.service';
import { QuizStateService } from '../../state/quizstate.service';
import { SelectedOptionService } from '../../state/selectedoption.service';
import { ExplanationFormatterService } from './explanation-formatter.service';

export type FETPayload = { idx: number; text: string; token: number };

@Injectable({ providedIn: 'root' })
export class ExplanationDisplayStateService {
  readonly explanationTextSig = signal<string | null>('');
  explanationText$: Observable<string | null> = toObservable(this.explanationTextSig);
  explanationTexts: Record<number, string> = {};

  private readonly globalContextKey = 'global';
  private explanationByContext = new Map<string, string>();
  private shouldDisplayByContext = new Map<string, boolean>();
  private displayedByContext = new Map<string, boolean>();

  isExplanationTextDisplayedSig = signal<boolean>(false);
  isExplanationTextDisplayed$ = toObservable(this.isExplanationTextDisplayedSig);

  private readonly isExplanationDisplayedSig = signal<boolean>(false);

  shouldDisplayExplanationSig = signal<boolean>(false);
  shouldDisplayExplanation$ = toObservable(this.shouldDisplayExplanationSig);

  private explanationTrigger = new Subject<void>();

  private readonly resetCompleteSig = signal<boolean>(false);

  currentQuestionExplanation: string | null = null;
  latestExplanation = '';

  private explanationLocked = false;
  private lockedContext: string | null = null;
  private lastExplanationSignature: string | null = null;
  private lastDisplaySignature: string | null = null;
  private lastDisplayedSignature: string | null = null;

  public _byIndex = new Map<number, BehaviorSubject<string | null>>();
  public _gate = new Map<number, BehaviorSubject<boolean>>();
  private _activeIndexValue: number | null = 0;

  public readonly activeIndexSig = signal<number>(0);
  public readonly activeIndex$ = toObservable(this.activeIndexSig);

  private readonly _readyForExplanationSig = signal<boolean>(false);

  public _visibilityLocked = false;

  // Tracks whether the current question text has rendered at least once.
  public readonly questionRenderedSig = signal<boolean>(false);
  public questionRendered$ = toObservable(this.questionRenderedSig);

  // Track which indices currently have open gates (used for cleanup)
  public _gatesByIndex: Map<number, BehaviorSubject<boolean>> = new Map();

  public _fetLocked: boolean | null = null;

  // Timestamp of the most recent navigation (from QuizNavigationService).
  public _lastNavTime = 0;

  public readonly quietZoneUntilSig = signal<number>(0);
  public quietZoneUntil$ = toObservable(this.quietZoneUntilSig);

  // Internal guards
  public _quietZoneUntil = 0;

  private _fetSubject = new ReplaySubject<FETPayload>(1);
  public fetPayload$: Observable<FETPayload> = this._fetSubject.asObservable();
  public _gateToken = 0;
  public _currentGateToken = 0;
  private _textMap: Map<number, { text$: ReplaySubject<string> }> = new Map();
  private readonly _instanceId: string = '';
  private _unlockRAFId: number | null = null;
  public latestExplanationIndex: number | null = -1;

  get _activeIndex(): number | null {
    return this._activeIndexValue;
  }
  set _activeIndex(value: number | null) {    this._activeIndexValue = value;
    if (value !== null) {
      this.activeIndexSig.set(value);
    }
  }

  get shouldDisplayExplanationSnapshot(): boolean {
    return this.shouldDisplayExplanationSig() === true;
  }

  constructor(
    private injector: Injector,
    private formatter: ExplanationFormatterService
  ) {
    this._instanceId = `EDS-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    // Always clear stale FET payloads when switching to a new question index.
    this.activeIndex$.pipe(
      distinctUntilChanged()
    ).subscribe((idx: number) => {
      this.latestExplanation = '';
      this.latestExplanationIndex = idx;
      this.explanationTextSig.set('');
      this.formatter.formattedExplanationSubject.next('');
      this.setShouldDisplayExplanation(false, { force: true });
      this.setIsExplanationTextDisplayed(false, { force: true });
      this._fetLocked = false;
    });
  }

  private _qss!: QuizStateService;
  private get qss(): QuizStateService {
    if (!this._qss) {
      this._qss = this.injector.get(QuizStateService);
    }
    return this._qss;
  }

  updateExplanationText(question: QuizQuestion): void {
    const explanation = question.explanation?.trim();

    // Guard: don't push placeholder text early
    if (!explanation || explanation === 'No explanation available') {      return;
    }

    this.explanationTextSig.set(explanation);
  }

  getLatestExplanation(): string {
    return this.latestExplanation;
  }

  prepareExplanationText(question: QuizQuestion): string {
    return question.explanation || 'No explanation available';
  }

  public lockExplanation(context?: string): void {
    this.explanationLocked = true;
    this.lockedContext = this.normalizeContext(context);
  }

  public unlockExplanation(): void {
    this.explanationLocked = false;
    this.lockedContext = null;
  }

  public isExplanationLocked(): boolean {
    return this.explanationLocked;
  }

  public setExplanationText(
    explanation: string | null,
    options: { force?: boolean; context?: string; index?: number } = {}
  ): void {
    const trimmed = (explanation ?? '').trim();
    const contextKey = this.normalizeContext(options.context);
    const signature = `${contextKey}:::${trimmed}`;

    // Ensure we track WHICH question this explanation belongs to
    const targetIdx = options.index ?? this._activeIndexValue;
    this.latestExplanationIndex = targetIdx;

    // ── CENTRALIZED MULTI-ANSWER GUARD ──────────────────────────────
    // Block non-empty FET text from entering the reactive pipeline for
    // multi-answer questions that are not yet fully resolved. This
    // prevents explanation text from reaching subscribeToDisplayText
    // and writeQText before all correct answers are selected.
    if (trimmed && !options.force) {
      try {
        const quizSvc = this.injector.get(QuizService, null);
        const selectedSvc = this.injector.get(SelectedOptionService, null);
        if (quizSvc && selectedSvc) {
          const activeIdx = targetIdx ?? quizSvc.getCurrentQuestionIndex?.() ?? 0;
          const rawQ: any = (quizSvc as any)?.questions?.[activeIdx];
          const rawOpts: any[] = rawQ?.options ?? [];
          const correctCount = rawOpts.filter(
            (o: any) => o?.correct === true || String(o?.correct) === 'true'
          ).length;
          if (correctCount > 1) {
            const norm = (t: any) => String(t ?? '').trim().toLowerCase();
            const correctTexts = rawOpts
              .filter((o: any) => o?.correct === true || String(o?.correct) === 'true')
              .map((o: any) => norm(o?.text))
              .filter((t: string) => !!t);
            const selections = selectedSvc.getSelectedOptionsForQuestion(activeIdx) ?? [];
            const selTexts = new Set(
              selections
                .filter((s: any) => s?.selected !== false)
                .map((s: any) => norm(s?.text))
                .filter((t: string) => !!t)
            );
            const allCorrectSelected = correctTexts.length > 0
              && correctTexts.every((t: string) => selTexts.has(t));
            if (!allCorrectSelected) {              return;
            }
          }
        }
      } catch { /* fall through if injection fails */ }
    }

    // Visibility lock: prevent overwrites during tab restore
    if ((this as any)._visibilityLocked) {      return;
    }

    if (!options.force && this.explanationLocked) {
      const lockedContext = this.lockedContext ?? this.globalContextKey;
      const contextsMatch =
        lockedContext === this.globalContextKey ||
        contextKey === this.globalContextKey ||
        lockedContext === contextKey;

      if (!contextsMatch) {        return;
      }

      if (trimmed === '') {        return;
      }
    }

    if (!options.force) {
      const previous = this.explanationByContext.get(contextKey) ?? '';
      if (previous === trimmed && signature === this.lastExplanationSignature) {        return;
      }
    }

    if (trimmed) {
      this.explanationByContext.set(contextKey, trimmed);
    } else {
      this.explanationByContext.delete(contextKey);
    }

    this.lastExplanationSignature = signature;

    let finalExplanation = trimmed;

    // Clear old explanation when we're NOT setting new text.
    // This prevents Q1's explanation from showing for Q2.
    if (!finalExplanation && this.latestExplanation) {      this.latestExplanation = '';
      this.latestExplanationIndex = targetIdx ?? this._activeIndex ?? 0;
    } else {
      this.latestExplanation = finalExplanation;
    }

    // Update the per-index subjects and collections if possible
    const qIdx = targetIdx !== null ? targetIdx : this._activeIndex;
    if (typeof qIdx === 'number' && qIdx >= 0) {
      const trimmedFinal = (finalExplanation ?? '').trim();

      // Update persistent indexed storage
      if (trimmedFinal) {
        this.formatter.formattedExplanations[qIdx] = {
          questionIndex: qIdx,
          explanation: trimmedFinal
        };
        this.formatter.fetByIndex.set(qIdx, trimmedFinal);
      } else {
        delete this.formatter.formattedExplanations[qIdx];
        this.formatter.fetByIndex.delete(qIdx);
      }

      // Notify the indexed reactive subjects
      try {
        const { text$ } = this.getOrCreate(qIdx);
        text$.next(trimmedFinal);
        this._byIndex.get(qIdx)?.next(trimmedFinal);
      } catch (e) {      }

      // Broadcast the change to the collection
      this.formatter.explanationsUpdatedSig.set({ ...this.formatter.formattedExplanations });
    }

    // Unified emission pipeline (Global)
    this.formatter.formattedExplanationSubject.next(finalExplanation);

    // Ensure direct subject update for visibility-stable downstream
    try {
      this.explanationTextSig.set(finalExplanation);
    } catch {
      // optional secondary stream
    }
  }

  setExplanationTextForQuestionIndex(index: number, explanation: string): void {
    if (index < 0) {      return;
    }

    const trimmed = (explanation ?? '').trim();
    const previous = this.explanationTexts[index];

    if (previous !== trimmed) {
      this.explanationTexts[index] = trimmed;
      this.formatter.formattedExplanationSubject.next(trimmed);

      this.emitFormatted(index, trimmed || null);
      this.setGate(index, !!trimmed);
    }
  }

  public getFormattedExplanationTextForQuestion(
    questionIndex: number
  ): Observable<string | null> {
    const FALLBACK = null;

    if (this._fetLocked) {
      const lockedEntry = this.formatter.formattedExplanations[questionIndex];
      const lockedExplanation = (lockedEntry?.explanation ?? '').trim();
      if (lockedExplanation) {
        try {
          this.emitFormatted(questionIndex, lockedExplanation);
          this.latestExplanation = lockedExplanation;
          this.latestExplanationIndex = questionIndex;
          this.setGate(questionIndex, true);
        } catch { }

        return new Observable(sub => { sub.next(lockedExplanation); sub.complete(); });
      }

      return new Observable(sub => { sub.next(FALLBACK); sub.complete(); });
    }

    // Step 1: Fully purge cached FET state if switching question
    if (this._activeIndex !== questionIndex) {      try {
        if ((this.latestExplanation ?? '') !== '') {
          this.formatter.formattedExplanationSubject?.next('');
        }

        if (this._activeIndex !== null) {
          this.emitFormatted(this._activeIndex, null);
          this.setGate(this._activeIndex, false);
        }

        this.latestExplanation = '';
        this.latestExplanationIndex = null;
        this._fetLocked = false;

        this.shouldDisplayExplanationSig.set(false);
        this.isExplanationTextDisplayedSig.set(false);
      } catch (err) {      }

      this._activeIndex = questionIndex;
      this.latestExplanationIndex = questionIndex;
    }

    // Normalize index FIRST
    const idx = Number(questionIndex);

    // Guard invalid
    if (!Number.isFinite(idx)) {
      try {
        this.emitFormatted(0, null);
      } catch { }
      try {
        this.setGate(0, false);
      } catch { }

      return new Observable(sub => { sub.next(FALLBACK); sub.complete(); });
    }

    // Allow rehydration after restore: refresh active index
    if (this._activeIndex === -1) {
      this._activeIndex = questionIndex;
    }

    const entry = this.formatter.formattedExplanations[questionIndex];
    if (!entry) {
      try {
        this.emitFormatted(questionIndex, null);
      } catch { }
      try {
        this.setGate(questionIndex, false);
      } catch { }
      return new Observable(sub => { sub.next(null); sub.complete(); });
    }

    const explanation = (entry.explanation ?? '').trim();
    if (!explanation) {      try {
        this.emitFormatted(questionIndex, null);
      } catch { }
      try {
        this.setGate(questionIndex, false);
      } catch { }
      return new Observable(sub => { sub.next(FALLBACK); sub.complete(); });
    }
    if (this._activeIndex !== questionIndex) {      this._activeIndex = questionIndex;
    }

    // Drive only the index-scoped channel (no global .next here)
    try {
      this.emitFormatted(questionIndex, explanation);
      this.latestExplanation = explanation;
      this.latestExplanationIndex = questionIndex;
    } catch { }

    try {
      this.setGate(questionIndex, true);
    } catch { }

    return new Observable(sub => { sub.next(explanation); sub.complete(); });
  }

  public getLatestFormattedExplanation(): string | null {
    const subj = this.formatter.formattedExplanationSubject as any;
    try {
      if (typeof subj.getValue === 'function') {
        return subj.getValue();
      }

      let val: string | null = null;
      subj.pipe(take(1)).subscribe((v: string) => (val = v));
      return val;
    } catch {
      return null;
    }
  }

  getFormattedExplanation(questionIndex: number): Observable<string> {
    if (!this.formatter.explanationsInitializedSig()) {
      return new Observable(sub => { sub.next('No explanation available'); sub.complete(); });
    }

    // Clear any stale formatted text whenever index changes
    if (
      this._activeIndex !== null &&
      this._activeIndex !== questionIndex &&
      this._activeIndex !== -1
    ) {
      try {
        this.emitFormatted(this._activeIndex, null);
      } catch { }
      try {
        this.setGate(this._activeIndex, false);
      } catch { }    }

    // Now safely update active index to current question
    this._activeIndex = questionIndex;

    return this.getFormattedExplanationTextForQuestion(questionIndex).pipe(
      map((explanationText: string | null) => {
        const text = explanationText?.trim() || 'No explanation available';

        if (this._activeIndex !== questionIndex) {          return this.latestExplanation || 'No explanation available';
        }

        return text;
      }),
    );
  }

  // Convenience accessor to avoid template/type metadata mismatches.
  getFormattedExplanationByIndex(): Observable<FETPayload> {
    return this._fetSubject.asObservable();
  }

  public setIsExplanationTextDisplayed(
    isDisplayed: boolean,
    options: { force?: boolean; context?: string } = {}
  ): void {
    // Visibility lock: prevent overwrites during visibility restore
    if ((this as any)._visibilityLocked) {      return;
    }

    const contextKey = this.normalizeContext(options.context);
    const signature = `${options.context ?? 'global'}:::${isDisplayed}`;

    if (!options.force) {
      const previous = this.displayedByContext.get(contextKey);
      if (
        previous === isDisplayed &&
        signature === this.lastDisplayedSignature
      ) {
        return;
      }
    }

    if (isDisplayed) {
      this.displayedByContext.set(contextKey, true);
    } else if (contextKey === this.globalContextKey) {
      this.displayedByContext.clear();
    } else {
      this.displayedByContext.delete(contextKey);
    }

    this.lastDisplayedSignature = signature;
    const aggregated = this.computeContextualFlag(this.displayedByContext);

    if (
      !options.force &&
      aggregated === this.isExplanationTextDisplayedSig()
    ) {
      return;
    }

    // Update the canonical BehaviorSubject
    this.isExplanationTextDisplayedSig.set(aggregated);

    // Also update a secondary Subject for legacy or parallel subscribers
    try {
      (this as any).isExplanationTextDisplayedSubject?.next(aggregated);
    } catch {
      // optional secondary push; ignore if missing
    }
  }

  public setShouldDisplayExplanation(
    shouldDisplay: boolean,
    options: { force?: boolean; context?: string } = {}
  ): void {
    // Visibility lock: prevent any reactive writes while restoring visibility
    if ((this as any)._visibilityLocked) {      return;
    }

    // ── CENTRALIZED MULTI-ANSWER GUARD ──────────────────────────────
    // Block setShouldDisplayExplanation(true) for multi-answer questions
    // unless ALL correct answers are currently selected. This is the
    // single choke point that prevents every upstream caller from
    // prematurely enabling FET on Q2/Q4.
    if (shouldDisplay && !options.force) {
      try {
        const quizSvc = this.injector.get(QuizService, null);
        const selectedSvc = this.injector.get(SelectedOptionService, null);
        if (quizSvc && selectedSvc) {
          const activeIdx = this._activeIndexValue ?? quizSvc.getCurrentQuestionIndex?.() ?? 0;

          // SHUFFLED FIX: use display-order question source
          const _isShufG = (quizSvc as any)?.isShuffleEnabled?.()
            && (quizSvc as any)?.shuffledQuestions?.length > 0;
          const rawQ: any = _isShufG
            ? ((quizSvc as any)?.getQuestionsInDisplayOrder?.()?.[activeIdx]
              ?? (quizSvc as any)?.shuffledQuestions?.[activeIdx]
              ?? (quizSvc as any)?.questions?.[activeIdx])
            : (quizSvc as any)?.questions?.[activeIdx];
          const rawOpts: any[] = rawQ?.options ?? [];
          const correctCount = rawOpts.filter(
            (o: any) => o?.correct === true || String(o?.correct) === 'true'
          ).length;
          if (correctCount > 1) {
            const norm = (t: any) => String(t ?? '').trim().toLowerCase();
            const correctTexts = rawOpts
              .filter((o: any) => o?.correct === true || String(o?.correct) === 'true')
              .map((o: any) => norm(o?.text))
              .filter((t: string) => !!t);
            const selections = selectedSvc.getSelectedOptionsForQuestion(activeIdx) ?? [];
            const selTexts = new Set(
              selections
                .filter((s: any) => s?.selected !== false)
                .map((s: any) => norm(s?.text))
                .filter((t: string) => !!t)
            );
            const allCorrectSelected = correctTexts.length > 0
              && correctTexts.every((t: string) => selTexts.has(t));
            if (!allCorrectSelected) {
              // Check questionCorrectness override before blocking
              const scoringSvc = (quizSvc as any)?.scoringService;
              const scoredCorrect = scoringSvc?.questionCorrectness?.get(activeIdx) === true;
              if (!scoredCorrect) {
                return;
              }
            }
          }
        }
      } catch { /* fall through if injection fails */ }
    }

    const contextKey = this.normalizeContext(options.context);
    const signature = `${options.context ?? 'global'}:::${shouldDisplay}`;

    if (!options.force) {
      const previous = this.shouldDisplayByContext.get(contextKey);
      if (
        previous === shouldDisplay &&
        signature === this.lastDisplaySignature
      ) {
        return;
      }
    }

    if (shouldDisplay) {
      this.shouldDisplayByContext.set(contextKey, true);
    } else if (contextKey === this.globalContextKey) {
      this.shouldDisplayByContext.clear();
    } else {
      this.shouldDisplayByContext.delete(contextKey);
    }

    this.lastDisplaySignature = signature;
    const aggregated = this.computeContextualFlag(this.shouldDisplayByContext);

    if (
      !options.force &&
      aggregated === this.shouldDisplayExplanationSig()
    ) {
      return;
    }

    // Normal reactive push (this is your main subject)
    this.shouldDisplayExplanationSig.set(aggregated);

    // Update Subject
    try {
      (this as any).shouldDisplayExplanationSubject?.next(aggregated);
    } catch {
      // Ignore — optional mirror stream
    }
  }

  public triggerExplanationEvaluation(): void {
    const currentExplanation = this.getLatestFormattedExplanation();
    const shouldShow = this.shouldDisplayExplanationSig();

    if (shouldShow && currentExplanation) {
      this.explanationTrigger.next();
      this.setExplanationText(currentExplanation, {
        force: true,
        context: 'evaluation'
      });
    }
  }

  setCurrentQuestionExplanation(explanation: string): void {
    this.currentQuestionExplanation = explanation;
  }

  private clearExplanationCaches(): void {
    this.latestExplanation = '';
    this.currentQuestionExplanation = null;

    this.lastExplanationSignature = null;
    this.lastDisplaySignature = null;
    this.lastDisplayedSignature = null;

    this.explanationByContext.clear();
    this.shouldDisplayByContext.clear();
    this.displayedByContext.clear();

    this.explanationTexts = {};
  }

  resetExplanationText(): void {
    this.clearExplanationCaches();

    this.setExplanationText('', { force: true });
    this.explanationTextSig.set('');
    this.setShouldDisplayExplanation(false, { force: true });
    this.setIsExplanationTextDisplayed(false, { force: true });

    this.isExplanationDisplayedSig.set(false);
  }

  resetStateBetweenQuestions(): void {
    this.resetExplanationState();
    this.formatter.resetProcessedQuestionsState();
  }

  resetExplanationState(): void {
    this.unlockExplanation();
    this.clearExplanationCaches();

    this.formatter.resetFormatterState();
    this._byIndex.clear();
    this._gate.clear();
    this._gatesByIndex.clear();
    this._textMap?.clear?.();
    this._fetLocked = null;
    this._gateToken = 0;
    this._currentGateToken = 0;
    this._activeIndex = null;
    this.latestExplanationIndex = -1;

    this.explanationTextSig.set('');
    this.formatter.formattedExplanationSubject.next('');
    this._fetSubject.next(undefined as any);

    this.shouldDisplayExplanationSig.set(false);
    this.isExplanationTextDisplayedSig.set(false);
    this.resetCompleteSig.set(false);

    // FET is definitely NOT ready after a full reset
    try {
      this.qss.setExplanationReady(false);
    } catch { }
  }

  setResetComplete(value: boolean): void {
    this.resetCompleteSig.set(value);
  }

  public forceResetBetweenQuestions(): void {
    this.resetExplanationState();
  }

  public normalizeContext(context?: string | null): string {
    const normalized = (context ?? '').toString().trim();
    return normalized || this.globalContextKey;
  }

  private computeContextualFlag(map: Map<string, boolean>): boolean {
    return [...map.values()].some(Boolean);
  }

  // Emit per-index formatted text; coalesces duplicates and broadcasts event
  public emitFormatted(
    index: number,
    value: string | null,
    options: { token?: number; bypassGuard?: boolean } = {}
  ): void {
    const { token = this._gateToken, bypassGuard = false } = options;
    // Lock immediately to prevent race conditions with reactive streams
    this._fetLocked = true;

    // ── MULTI-ANSWER GUARD ──────────────────────────────────────────────
    if (value && index >= 0) {
      try {
        const quizSvc = this.injector.get(QuizService, null);
        const selectedSvc = this.injector.get(SelectedOptionService, null);

        if (quizSvc) {
          const isShuffled = quizSvc.isShuffleEnabled?.() ?? false;
          const shuffled = Array.isArray((quizSvc as any).shuffledQuestions)
            ? (quizSvc as any).shuffledQuestions
            : [];
          const baseQuestions = isShuffled && shuffled.length > 0
            ? shuffled
            : quizSvc.questions;

          // Prefer display-order accessor when available
          const displayQuestions =
            typeof (quizSvc as any).getQuestionsInDisplayOrder === 'function'
              ? (quizSvc as any).getQuestionsInDisplayOrder()
              : baseQuestions;

          const question = displayQuestions?.[index] ?? baseQuestions?.[index] ?? null;
          let correctCount = 0;

          if (question && Array.isArray(question.options)) {
            correctCount = question.options.filter(
              (o: any) => o.correct === true || String(o.correct) === 'true'
            ).length;
          }

          // Determine authoritative correct count from RAW questions (unmutated).
          const rawQs: any[] = (quizSvc as any).questions ?? [];
          const rawQ: any = rawQs[index] ?? question;
          const rawCorrectCount = (rawQ?.options ?? []).filter(
            (o: any) => o?.correct === true || String(o?.correct) === 'true'
          ).length;
          const effectiveCorrectCount = Math.max(correctCount, rawCorrectCount);

          // Multi-answer gate: block FET until ALL correct answers are selected.
          // Uses raw question options as source of truth so mutated display-
          // order copies with scrambled correct flags don't fool the check.
          if (!bypassGuard && effectiveCorrectCount > 1) {
            const sos = this.injector.get(SelectedOptionService, null);
            const selections = sos?.selectedOptionsMap?.get(index) ?? [];
            const norm = (t: any) => String(t ?? '').trim().toLowerCase();
            const rawOpts: any[] = rawQ?.options ?? [];
            const rawCorrectTexts = new Set(
              rawOpts.filter((o: any) => o?.correct === true || String(o?.correct) === 'true')
                .map((o: any) => norm(o?.text)).filter((t: string) => !!t)
            );
            const selTexts = new Set(
              (selections as any[]).map((s: any) => norm(s?.text)).filter((t: string) => !!t)
            );
            const allCorrectSel = rawCorrectTexts.size > 0 && [...rawCorrectTexts].every(t => selTexts.has(t));

            const perfectMap = (quizSvc as any)._multiAnswerPerfect as Map<number, boolean> | undefined;
            const oisPerfect = perfectMap?.get(index) === true;

            if (!oisPerfect && !allCorrectSel) {              this._fetLocked = false;
              return;
            }          }
        }
      } catch (e) {      }
    }

    const trimmed = (value ?? '').trim();
    if (!trimmed) {      return;
    }

    // Allow re-emission of same content if it's important (e.g., after navigation)
    if (trimmed === (this.latestExplanation ?? '').trim()) {    }

    this.latestExplanationIndex = index;

    // ── GUARDRAIL: Validate prefix option numbers against visual data ──
    let validatedText = this.formatter.validateAndCorrectFetPrefix(trimmed, index);

    this.latestExplanation = validatedText;

    // Store in Map by index for reliable retrieval
    this.formatter.fetByIndex.set(index, validatedText);

    // Also emit to formattedExplanationSubject for FINAL LAYER.
    this.formatter.formattedExplanationSubject.next(validatedText);

    // Emit immediately without waiting for requestAnimationFrame.    this.safeNext(this._fetSubject, { idx: index, text: validatedText, token });
    this.shouldDisplayExplanationSig.set(true);
    this.isExplanationTextDisplayedSig.set(true);

    // At this point, FET is computed and "ready" for this question
    try {
      this.getOrCreate(index).text$.next(validatedText);
      this._byIndex.get(index)?.next(validatedText);
    } catch { }

    try {
      this.qss.setExplanationReady(true);
    } catch { }
  }

  public setGate(index: number, show: boolean): void {
    const idx = Math.max(0, Number(index) || 0);
    if (!this._gate.has(idx)) {
      this._gate.set(idx, new BehaviorSubject<boolean>(false));
    }
    const bs = this._gate.get(idx)!;
    const next = show;
    if (bs.getValue() !== next) bs.next(next);  // coalesce
  }

  // Call to open a gate for an index
  public openExclusive(index: number, text: string): void {
    const token = this._currentGateToken;

    // Pre-guards
    if (
      this._fetLocked ||
      index !== this._activeIndex ||
      token !== this._gateToken
    ) {      return;
    }

    const trimmed = (text ?? '').trim();
    if (!trimmed || trimmed === this.latestExplanation?.trim()) return;

    this.latestExplanation = trimmed;

    // One-frame emit with re-checks
    requestAnimationFrame(() => {
      if (
        this._fetLocked ||
        index !== this._activeIndex ||
        token !== this._currentGateToken
      ) {        return;
      }
      this.safeNext(this.formatter.formattedExplanationSubject, trimmed);
      this.shouldDisplayExplanationSig.set(true);
      this.isExplanationTextDisplayedSig.set(true);

      // FET now open and visible for this index
      try {
        this.qss.setExplanationReady(true);
      } catch { }
    });
  }

  // Holds a per-question text$ stream (isolated subjects by index)
  public getOrCreate(index: number) {
    // Ensure a dedicated text$ stream exists for each question index
    let textEntry = this._textMap.get(index);
    if (!textEntry) {
      textEntry = { text$: new ReplaySubject<string>(1) };
      this._textMap.set(index, textEntry);
    }

    // Maintain compatibility with old BehaviorSubjects
    if (!this._byIndex.has(index)) {
      this._byIndex.set(index, new BehaviorSubject<string | null>(null));
    }

    if (!this._gate.has(index)) {
      this._gate.set(index, new BehaviorSubject<boolean>(false));
    }

    return {
      text$: textEntry.text$,
      gate$: this._gate.get(index)!
    };
  }

  // Returns a reactive stream for a given question index
  public getExplanationText$(index: number): Observable<string | null> {
    const { text$ } = this.getOrCreate(index);
    const existing = this.formatter.formattedExplanations[index]?.explanation || this.formatter.fetByIndex.get(index) || '';

    return merge(
      text$,
      this.formatter.explanationsUpdated$.pipe(
        map(dict => dict[index]?.explanation || ''),
        distinctUntilChanged()
      )
    ).pipe(
      startWith(existing),
      distinctUntilChanged()
    );
  }

  // Reset explanation state cleanly for a new index
  public resetForIndex(index: number): void {
    if (
      this._activeIndex !== null &&
      this._activeIndex !== -1 &&
      this._activeIndex !== index
    ) {
      try {
        this._gate.get(this._activeIndex)?.next(false);
      } catch { }

      this.latestExplanation = '';
      this.latestExplanationIndex = null;
      this.formatter.formattedExplanationSubject?.next('');
      this.setShouldDisplayExplanation(false, { force: true });
      this.setIsExplanationTextDisplayed(false, { force: true });    }

    // Ensure and hard-emit for new index
    const { text$, gate$ } = this.getOrCreate(index);
    const cachedFet = this.formatter.formattedExplanations[index]?.explanation?.trim()
      || this.formatter.fetByIndex.get(index)?.trim()
      || '';
    try {
      text$.next(cachedFet || '');
    } catch { }
    try {
      gate$.next(false);
    } catch { }

    this._activeIndex = index;
    this.latestExplanationIndex = index;
    if (!cachedFet) {
      this.formatter.formattedExplanations[index] = {
        questionIndex: index,
        explanation: ''
      };
    }
    try {
      this.qss.setExplanationReady(false);
    } catch { }
  }

  // Set readiness flag
  public setReadyForExplanation(ready: boolean): void {
    this._readyForExplanationSig.set(ready);  }

  public async waitUntilQuestionRendered(timeoutMs = 500): Promise<void> {
    try {
      await firstValueFrom(
        this.questionRendered$.pipe(
          filter((v) => v),
          take(1),
          timeout(timeoutMs)
        ),
      );
    } catch {
      // Swallow timeouts or interruptions silently
    }
  }

  public closeGateForIndex(index: number): void {
    const gate = this._gatesByIndex?.get(index);
    if (gate) gate.next(false);
  }

  public closeAllGates(): void {
    this._gatesByIndex.clear();
    this._fetLocked = null;

    try {
      this.setShouldDisplayExplanation(false, { force: true });
      this.setIsExplanationTextDisplayed(false);
    } catch (err) {    }  }

  public markLastNavTime(time: number): void {
    this._lastNavTime = time;
  }

  public setQuietZone(durationMs: number): void {
    const until = performance.now() + Math.max(0, durationMs);
    this._quietZoneUntil = until;
    this.quietZoneUntilSig.set(until);  }

  public purgeAndDefer(newIndex: number): void {
    // Bump generation and lock everything immediately
    this._gateToken++;
    this._currentGateToken = this._gateToken;
    this._activeIndex = newIndex;
    this._fetLocked = true;

    // Stop all lingering subjects to prevent replay from Q1
    try {
      if (this.formatter.formattedExplanationSubject) {
        this.formatter.formattedExplanationSubject.next('');
      }
    } catch { }
    this.formatter.formattedExplanation$ = this.formatter.formattedExplanationSubject.asObservable();

    // Hard reset every flag
    this.latestExplanation = '';
    if (this._activeIndex !== newIndex) {
      this.setShouldDisplayExplanation(false);
    }
    this.setIsExplanationTextDisplayed(false);
    this._textMap?.delete?.(newIndex);

    // Preserve cached FET for back-navigation.
    const hasCachedFet = !!(this.formatter.formattedExplanations[newIndex]?.explanation?.trim()
      || this.formatter.fetByIndex.get(newIndex)?.trim());
    if (!hasCachedFet) {
      this.formatter.fetByIndex.delete(newIndex);
      this.formatter.lockedFetIndices.delete(newIndex);
    }
    if (this.latestExplanationIndex === newIndex) {
      this.latestExplanationIndex = newIndex;
    }

    // Navigation in progress -> explanation not ready
    try {
      this.qss.setExplanationReady(false);
    } catch { }

    // Cancel any pending unlocks from older cycles
    if (this._unlockRAFId != null) {
      cancelAnimationFrame(this._unlockRAFId);
      this._unlockRAFId = null;
    }

    // Strict token-based unlock logic
    const localToken = this._currentGateToken;
    this._unlockRAFId = requestAnimationFrame(() => {
      setTimeout(() => {
        if (this._currentGateToken !== localToken) {          return;
        }

        this._fetLocked = false;      }, 120);
    });
  }

  // Helper
  private safeNext<T>(s: any, v: T) {
    if (s && typeof s.next === 'function') s.next(v);
  }
}
