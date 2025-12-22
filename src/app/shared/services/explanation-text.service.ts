import { Injectable, Injector } from '@angular/core';
import {
  BehaviorSubject,
  EMPTY,
  firstValueFrom,
  Observable,
  of,
  ReplaySubject,
  Subject,
} from 'rxjs';
import {
  distinctUntilChanged,
  filter,
  map,
  skip,
  take,
  timeout,
} from 'rxjs/operators';

import { QuestionType } from '../models/question-type.enum';
import { FormattedExplanation } from '../models/FormattedExplanation.model';
import { Option } from '../models/Option.model';
import { QuizQuestion } from '../models/QuizQuestion.model';
import { QuizService } from '../services/quiz.service';
import { QuizStateService } from '../services/quizstate.service';
import { isValidOption } from '../utils/option-utils';

// type FETPayload = { idx: number; text: string; token: number };
export type FETPayload = { idx: number; text: string; token: number };

@Injectable({ providedIn: 'root' })
export class ExplanationTextService {
  private explanationTextSubject = new BehaviorSubject<string>('');
  explanationText$: BehaviorSubject<string | null> = new BehaviorSubject<
    string | null
  >('');
  explanationTexts: Record<number, string> = {};

  formattedExplanations: Record<number, FormattedExplanation> = {};
  formattedExplanations$: BehaviorSubject<string | null>[] = [];
  formattedExplanationSubject = new BehaviorSubject<string>('');
  formattedExplanation$ = this.formattedExplanationSubject.asObservable();
  private formattedExplanationByQuestionText = new Map<string, string>();

  private readonly globalContextKey = 'global';
  private explanationByContext = new Map<string, string>();
  private shouldDisplayByContext = new Map<string, boolean>();
  private displayedByContext = new Map<string, boolean>();

  private explanationsUpdated = new BehaviorSubject<
    Record<number, FormattedExplanation>
  >(this.formattedExplanations);

  isExplanationTextDisplayedSource = new BehaviorSubject<boolean>(false);
  isExplanationTextDisplayed$ =
    this.isExplanationTextDisplayedSource.asObservable();

  private isExplanationDisplayedSource = new BehaviorSubject<boolean>(false);

  shouldDisplayExplanationSource = new BehaviorSubject<boolean>(false);
  shouldDisplayExplanation$ =
    this.shouldDisplayExplanationSource.asObservable();

  private explanationTrigger = new Subject<void>();

  private resetCompleteSubject = new BehaviorSubject<boolean>(false);

  processedQuestions: Set<string> = new Set<string>();
  currentQuestionExplanation: string | null = null;
  latestExplanation = '';

  // FET cache by index - reliable storage that won't be cleared by stream timing issues
  public fetByIndex = new Map<number, string>();
  explanationsInitialized = false;
  private explanationLocked = false;
  private lockedContext: string | null = null;
  private lastExplanationSignature: string | null = null;
  private lastDisplaySignature: string | null = null;
  private lastDisplayedSignature: string | null = null;

  public _byIndex = new Map<number, BehaviorSubject<string | null>>();
  public _gate = new Map<number, BehaviorSubject<boolean>>();
  private _activeIndexValue: number | null = 0; // Start at 0 to match activeIndex$ initial value
  get _activeIndex(): number | null {
    return this._activeIndexValue;
  }
  set _activeIndex(value: number | null) {
    console.log(`[ETS] 📍 _activeIndex SET: ${this._activeIndexValue} → ${value}`);
    this._activeIndexValue = value;
    if (value !== null) {
      this.activeIndex$.next(value);
    }
  }
  public readonly activeIndex$ = new BehaviorSubject<number>(0);

  private _readyForExplanation$ = new BehaviorSubject<boolean>(false);

  public _visibilityLocked = false;

  // Tracks whether the current question text has rendered at least once.
  public questionRendered$ = new BehaviorSubject<boolean>(false);

  // Track which indices currently have open gates (used for cleanup)
  public _gatesByIndex: Map<number, BehaviorSubject<boolean>> = new Map();

  public _fetLocked: boolean | null = null;

  // Timestamp of the most recent navigation (from QuizNavigationService).
  public _lastNavTime = 0;

  public quietZoneUntil$ = new BehaviorSubject<number>(0);

  // Internal guards (already have some of these — keep if they exist)
  public _quietZoneUntil = 0;

  private _fetSubject = new ReplaySubject<FETPayload>(1);
  public _gateToken = 0;
  public _currentGateToken = 0;
  private _textMap: Map<number, { text$: ReplaySubject<string> }> = new Map();
  private readonly _instanceId: string = '';
  private _unlockRAFId: number | null = null;
  public latestExplanationIndex: number | null = 0; // Start at 0 to match activeIndex$ initial value

  // Convenience accessor to avoid template/type metadata mismatches.
  getFormattedExplanationByIndex(): Observable<FETPayload> {
    return this._fetSubject.asObservable();
  }

  constructor(private injector: Injector) {
    this._instanceId = `ETS-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    console.log(`[${this._instanceId}] ExplanationTextService initialized`);

    // Always clear stale FET payloads when switching to a new question index.
    // Without this, the previous question's formatted explanation (e.g., Q1)
    // can remain in the global subject and be rendered for later questions
    // such as Q4 before their own FET is ready.
    // NOTE: skip(1) prevents the initial BehaviorSubject emission from clearing state during init.
    this.activeIndex$.pipe(
      skip(1), // Skip the initial value (0) so Q1's FET isn't cleared during initialization
      distinctUntilChanged()
    ).subscribe((idx: number) => {
      // Don't clear if FET has already been set for this index (user clicked)
      if (this._fetLocked) {
        console.log(`[ETS] Skipping clear - FET locked for Q${idx + 1}`);
        return;
      }
      this.latestExplanation = '';
      this.latestExplanationIndex = idx; // Set to new index instead of null
      this.formattedExplanationSubject.next('');
      this.setShouldDisplayExplanation(false, { force: true });
      this.setIsExplanationTextDisplayed(false, { force: true });
    });
  }

  private _qss!: QuizStateService;
  private get qss(): QuizStateService {
    if (!this._qss) {
      this._qss = this.injector.get(QuizStateService);
    }
    return this._qss;
  }

  get shouldDisplayExplanationSnapshot(): boolean {
    return this.shouldDisplayExplanationSource.getValue() === true;
  }

  updateExplanationText(question: QuizQuestion): void {
    const explanation = question.explanation?.trim();

    // Guard: don't push placeholder text early
    if (!explanation || explanation === 'No explanation available') {
      console.log('[ETS] ⏸ No valid explanation yet — skipping emit.');
      return;
    }

    this.explanationTextSubject.next(explanation);
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
    options: { force?: boolean; context?: string } = {},
  ): void {
    const trimmed = (explanation ?? '').trim();
    const contextKey = this.normalizeContext(options.context);
    const signature = `${contextKey}:::${trimmed}`;
    console.log(
      `[ETS] setExplanationText called with: "${trimmed}" (context: ${contextKey})`,
    );

    // ✅ FIX: Ensure we track WHICH question this explanation belongs to
    this.latestExplanationIndex = this._activeIndexValue;

    // Visibility lock: prevent overwrites during tab restore
    if ((this as any)._visibilityLocked) {
      console.log('[ETS] ⏸ Ignored setExplanationText while locked');
      return;
    }

    if (!options.force && this.explanationLocked) {
      const lockedContext = this.lockedContext ?? this.globalContextKey;
      const contextsMatch =
        lockedContext === this.globalContextKey ||
        contextKey === this.globalContextKey ||
        lockedContext === contextKey;

      if (!contextsMatch) {
        console.warn(
          `[🛡️ Blocked explanation update for ${contextKey} while locked to ${lockedContext}]`,
        );
        return;
      }

      if (trimmed === '') {
        console.warn('[🛡️ Blocked reset: explanation is locked]');
        return;
      }
    }

    if (!options.force) {
      const previous = this.explanationByContext.get(contextKey) ?? '';
      if (previous === trimmed && signature === this.lastExplanationSignature) {
        console.log(
          `[🛡️ Prevented duplicate emit${contextKey !== this.globalContextKey ? ` for ${contextKey}` : ''
          }]`,
        );
        return;
      }
    }

    if (trimmed) {
      this.explanationByContext.set(contextKey, trimmed);
    } else {
      this.explanationByContext.delete(contextKey);
    }

    this.lastExplanationSignature = signature;

    // ✅ AUTO-FORMAT: Check if explanation needs formatting and format it
    let finalExplanation = trimmed;
    if (
      trimmed &&
      this._activeIndexValue !== null &&
      trimmed !== 'No explanation available'
    ) {
      // Check if already formatted
      const alreadyFormattedRe =
        /^(?:option|options)\s+\d+(?:\s*,\s*\d+)*(?:\s+and\s+\d+)?\s+(?:is|are)\s+correct\s+because\s+/i;

      if (!alreadyFormattedRe.test(trimmed)) {
        console.log(
          '[ETS] ⚙️ Auto-formatting explanation for Q' +
          (this._activeIndexValue + 1),
        );

        // Try to get the question data to format the explanation
        try {
          // Use Injector to get QuizService dynamically (avoids circular dependency)
          // We use a token approach to avoid importing QuizService directly
          const quizService = this.injector.get(QuizService, null);

          // ✅ Use the public questions cache instead of relying on questionsArray
          const questions = quizService?.questions;

          if (quizService && Array.isArray(questions)) {
            // Get question synchronously from the service's cache
            const questionData = questions[this._activeIndexValue];

            if (questionData) {
              const correctIndices = this.getCorrectOptionIndices(questionData);
              finalExplanation = this.formatExplanation(
                questionData,
                correctIndices,
                trimmed,
              );
              console.log(
                '[ETS] ✅ Auto-formatted:',
                finalExplanation.slice(0, 80),
              );
            } else {
              console.warn(
                '[ETS] ⚠️ Question data not available for auto-formatting',
              );
            }
          } else {
            console.warn(
              '[ETS] ⚠️ QuizService not available or questions not loaded for auto-formatting',
            );
          }
        } catch (err) {
          console.warn('[ETS] ⚠️ Auto-format failed, using raw text:', err);
        }
      }
    }

    // ✅ FIX: Clear old explanation when we're NOT setting new text
    // This prevents Q1's explanation from showing for Q2
    if (!finalExplanation && this.latestExplanation) {
      console.log('[ETS] Clearing stale explanation');
      this.latestExplanation = '';
      // Keep index aligned instead of null so subsequent questions work
      this.latestExplanationIndex = this._activeIndex ?? 0;
    } else {
      this.latestExplanation = finalExplanation;
    }

    // Unified emission pipeline
    console.log(
      `[ETS] Emitting to formattedExplanationSubject: "${finalExplanation}"`,
    );
    this.explanationText$.next(finalExplanation);
    this.formattedExplanationSubject.next(finalExplanation);

    // Ensure direct subject update for visibility-stable downstream
    try {
      (this as any).explanationTextSubject?.next(finalExplanation);
    } catch {
      // optional secondary stream
    }
  }

  // Synchronous lookup by question index
  public getFormattedSync(qIdx: number): string | undefined {
    return this.formattedExplanations[qIdx]?.explanation;
  }

  setExplanationTextForQuestionIndex(index: number, explanation: string): void {
    if (index < 0) {
      console.warn(
        `Invalid index: ${index}, must be greater than or equal to 0`,
      );
      return;
    }

    const trimmed = (explanation ?? '').trim();
    const previous = this.explanationTexts[index];

    if (previous !== trimmed) {
      this.explanationTexts[index] = trimmed;
      this.formattedExplanationSubject.next(trimmed);

      this.emitFormatted(index, trimmed || null);
      this.setGate(index, !!trimmed);
    }
  }

  public getFormattedExplanationTextForQuestion(
    questionIndex: number,
  ): Observable<string | null> {
    const FALLBACK = 'No explanation available';

    if (this._fetLocked) {
      console.log(
        `[ETS] ⏸ FET locked, returning fallback for Q${questionIndex + 1}`,
      );
      // Return fallback instead of EMPTY to prevent firstValueFrom errors
      return of(FALLBACK);
    }

    // ────────────────────────────────────────────────
    // 🧹 Step 1: Fully purge cached FET state if switching question
    // Prevents Q1's explanation from leaking into Q2.
    // ────────────────────────────────────────────────
    if (this._activeIndex !== questionIndex) {
      console.warn(
        `[ETS] ⚠️ Index mismatch detected! Active=${this._activeIndex}, Requested=${questionIndex}. Purging state...`,
      );
      try {
        // Clear all channels immediately before anything else runs
        if ((this.latestExplanation ?? '') !== '') {
          this.formattedExplanationSubject?.next('');
        }

        if (this._activeIndex !== null) {
          this.emitFormatted(this._activeIndex, null);
          this.setGate(this._activeIndex, false);
        }

        this.latestExplanation = '';
        this.latestExplanationIndex = null; // ✅ Force clear index
        this._fetLocked = false;

        if (this.shouldDisplayExplanation$ instanceof BehaviorSubject)
          this.shouldDisplayExplanation$.next(false);
        if (this.isExplanationTextDisplayed$ instanceof BehaviorSubject)
          this.isExplanationTextDisplayed$.next(false);

        console.log(
          `[ETS] 🧼 Full reset (prev=${this._activeIndex}, new=${questionIndex})`,
        );
      } catch (err) {
        console.warn('[ETS] ⚠️ Failed to clear stale FET state', err);
      }

      this._activeIndex = questionIndex;
      this.latestExplanationIndex = questionIndex; // Ensure index matches after reset
    } else {
      console.log(
        `[ETS] ℹ️ Index match: Active=${this._activeIndex}, Requested=${questionIndex}`,
      );
    }

    // Normalize index FIRST
    const idx = Number(questionIndex);

    // Guard invalid
    if (!Number.isFinite(idx)) {
      console.error(
        `[❌ Invalid questionIndex — must be a finite number]:`,
        questionIndex,
      );

      try {
        this.emitFormatted(0, null);
      } catch { }
      try {
        this.setGate(0, false);
      } catch { }

      return of(FALLBACK);
    }

    // Allow rehydration after restore: refresh active index
    if (this._activeIndex === -1) {
      this._activeIndex = questionIndex;
    }

    const entry = this.formattedExplanations[questionIndex];
    if (!entry) {
      console.error(
        `[❌ Q${questionIndex} not found in formattedExplanations`,
        entry,
      );
      console.log('🧾 All formattedExplanations:', this.formattedExplanations);

      try {
        this.emitFormatted(questionIndex, null);
      } catch { }
      try {
        this.setGate(questionIndex, false);
      } catch { }
      return of(null);
    }

    const explanation = (entry.explanation ?? '').trim();
    if (!explanation) {
      console.warn(`[⚠️ No valid explanation for Q${questionIndex}]`);
      try {
        this.emitFormatted(questionIndex, null);
      } catch { }
      try {
        this.setGate(questionIndex, false);
      } catch { }
      return of(FALLBACK);
    }

    // ✅ FIX: Auto-open gate when we have a valid formatted explanation
    // This ensures the explanation displays after option selection
    console.log(
      `[ETS] ✅ Valid explanation found for Q${questionIndex + 1}, opening gate`,
    );

    // ✅ CRITICAL FIX: Ensure _activeIndex is set BEFORE the guard check
    // This prevents FET from being blocked when _activeIndex is null/different
    if (this._activeIndex !== questionIndex) {
      console.log(`[ETS] � Setting _activeIndex: ${this._activeIndex} → ${questionIndex} before emit`);
      this._activeIndex = questionIndex;
    }

    // Guard is now effectively a no-op since we just ensured the match above
    // Keeping the log for debugging purposes

    // Drive only the index-scoped channel (no global .next here)
    try {
      this.emitFormatted(questionIndex, explanation);
      this.latestExplanation = explanation;
      this.latestExplanationIndex = questionIndex;
    } catch { }

    // ✅ Open the gate and set display flags
    try {
      this.setGate(questionIndex, true);
      this.setShouldDisplayExplanation(true);
      this.setIsExplanationTextDisplayed(true);
    } catch { }

    return of(explanation);
  }

  public getLatestFormattedExplanation(): string | null {
    const subj = this.formattedExplanationSubject as any;
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

  initializeExplanationTexts(explanations: string[]): void {
    this.explanationTexts = {};
    this.formattedExplanationByQuestionText.clear();

    for (const [index, explanation] of explanations.entries()) {
      this.explanationTexts[index] = explanation;
    }
  }

  initializeFormattedExplanations(
    explanations: { questionIndex: number; explanation: string }[],
  ): void {
    this.formattedExplanations = {}; // clear existing data
    this.formattedExplanationByQuestionText.clear();

    if (!Array.isArray(explanations) || explanations.length === 0) {
      console.warn('No explanations provided for initialization.');
      return;
    }

    for (const entry of explanations) {
      const idx = Number(entry.questionIndex);
      const text = entry.explanation ?? '';

      if (!Number.isFinite(idx) || idx < 0) {
        console.warn(`Invalid questionIndex:`, entry.questionIndex);
        continue;
      }

      const trimmed = String(text).trim();

      this.formattedExplanations[idx] = {
        questionIndex: idx,
        explanation: trimmed || 'No explanation available',
      };
    }

    console.log(
      `[ETS] ✅ Initialized ${Object.keys(this.formattedExplanations).length} formatted explanations`,
    );
    console.log(
      `[ETS] Sample Q0:`,
      this.formattedExplanations[0]?.explanation?.slice(0, 80),
    );
    console.log(
      `[ETS] Sample Q2:`,
      this.formattedExplanations[2]?.explanation?.slice(0, 80),
    );

    // Notify subscribers about the updated explanations
    this.explanationsUpdated.next(this.formattedExplanations);
  }

  formatExplanationText(
    question: QuizQuestion,
    questionIndex: number,
  ): Observable<{ questionIndex: number; explanation: string }> {
    // Early exit for invalid or stale questions
    if (!this.isQuestionValid(question)) {
      console.warn(
        `[⏩ Skipping invalid or stale question at index ${questionIndex}]`,
      );
      return of({ questionIndex, explanation: '' });
    }

    // Explanation fallback if missing or blank
    const rawExplanation =
      question?.explanation?.trim() || 'Explanation not provided';

    // Idempotency detector (same as in formatExplanation)
    const alreadyFormattedRe =
      /^(?:option|options)\s+\d+(?:\s*,\s*\d+)*(?:\s+and\s+\d+)?\s+(?:is|are)\s+correct\s+because\s+/i;

    // Format explanation (only if not already formatted)
    const correctOptionIndices = this.getCorrectOptionIndices(question);
    const formattedExplanation = alreadyFormattedRe.test(rawExplanation)
      ? rawExplanation
      : this.formatExplanation(question, correctOptionIndices, rawExplanation);

    // Store and sync (but coalesce to avoid redundant emits)
    const prev =
      this.formattedExplanations[questionIndex]?.explanation?.trim() || '';
    if (prev !== formattedExplanation) {
      this.storeFormattedExplanation(
        questionIndex,
        formattedExplanation,
        question,
      );
      this.syncFormattedExplanationState(questionIndex, formattedExplanation);
      this.updateFormattedExplanation(formattedExplanation);
    }

    // Prevent duplicate processing
    const questionKey =
      question?.questionText ?? JSON.stringify({ i: questionIndex });
    this.processedQuestions.add(questionKey);

    return of({
      questionIndex,
      explanation: formattedExplanation,
    });
  }

  updateFormattedExplanation(explanation: string): void {
    const trimmed = explanation?.trim();
    if (!trimmed) return;

    this.formattedExplanationSubject.next(trimmed);
  }

  storeFormattedExplanation(
    index: number,
    explanation: string,
    question: QuizQuestion,
  ): void {
    if (index < 0) {
      console.error(
        `Invalid index: ${index}, must be greater than or equal to 0`,
      );
      return;
    }

    if (!explanation || explanation.trim() === '') {
      console.error(`Invalid explanation: "${explanation}"`);
      return;
    }

    const sanitizedExplanation = explanation.trim();
    const correctOptionIndices = this.getCorrectOptionIndices(question);
    const formattedExplanation = this.formatExplanation(
      question,
      correctOptionIndices,
      sanitizedExplanation,
    );

    this.formattedExplanations[index] = {
      questionIndex: index,
      explanation: formattedExplanation,
    };

    this.storeFormattedExplanationForQuestion(
      question,
      index,
      formattedExplanation,
    );

    this.explanationsUpdated.next(this.formattedExplanations);
  }

  private storeFormattedExplanationForQuestion(
    question: QuizQuestion,
    index: number,
    explanation: string,
  ): void {
    if (!question) {
      return;
    }

    const keyWithoutIndex = this.buildQuestionKey(question?.questionText);
    const keyWithIndex = this.buildQuestionKey(question?.questionText, index);

    if (keyWithoutIndex) {
      this.formattedExplanationByQuestionText.set(keyWithoutIndex, explanation);
    }

    if (keyWithIndex) {
      this.formattedExplanationByQuestionText.set(keyWithIndex, explanation);
    }
  }


  getCorrectOptionIndices(
    question: QuizQuestion,
    options?: Option[],
  ): number[] {
    // 🔑 VISUAL ALIGNMENT FIX: Use the raw input array directly!
    // The "options" argument is typically 'optionsToDisplay' from the UI.
    // If we filter it, we shift the indices, causing "Option 2" to become "Option 1"
    // in the text while remaining "Option 2" on screen.
    const opts = options || question?.options || [];

    if (!Array.isArray(opts) || opts.length === 0) {
      console.warn('No options found for question:', question?.questionText);
      return [];
    }

    const indices = opts
      .map((option, idx) => {
        // Skip invalid/null options visually, but preserve their index slot
        // if they take up space? No, usually isValidOption checks if it's a real option.
        // But if the UI displays it, we count it.
        if (!option || !option.correct) return null;

        // Use the array index directly.
        // This assumes 'opts' aligns 1:1 with the rendered list.
        return idx + 1; // 1-based for "Option N"
      })
      .filter((n): n is number => n !== null);

    // Dedupe + sort for a stable, readable string
    return Array.from(new Set(indices)).sort((a, b) => a - b);
  }

  formatExplanation(
    question: QuizQuestion,
    correctOptionIndices: number[] | null | undefined,
    explanation: string,
  ): string {
    // Idempotency: if already in "Option(s) ... correct because ..." form, return as-is.
    const alreadyFormattedRe =
      /^(?:option|options)\s+\d+(?:\s*,\s*\d+)*(?:\s+and\s+\d+)?\s+(?:is|are)\s+correct\s+because\s+/i;

    const e = (explanation ?? '').trim();
    if (!e) return '';

    if (alreadyFormattedRe.test(e)) {
      // Already formatted elsewhere; do not re-wrap (prevents "Option 1 is correct because Option 1 is correct because...")
      return e;
    }

    // Normalize incoming indices (might be null/undefined/empty on timeout)
    let indices: number[] = Array.isArray(correctOptionIndices)
      ? correctOptionIndices.slice()
      : [];

    // Fallback: derive from the question’s own option flags (use 1-based for display to match typical copy)
    if (indices.length === 0 && Array.isArray(question?.options)) {
      indices = question.options
        .map((opt, i) => {
          if (!opt?.correct) {
            return -1;
          }
          const hasValidDisplayOrder =
            typeof opt.displayOrder === 'number' &&
            Number.isFinite(opt.displayOrder) &&
            opt.displayOrder >= 0;

          const displayIndex = hasValidDisplayOrder ? opt.displayOrder : i;
          return (displayIndex ?? 0) + 1;
        })
        .filter((n) => n > 0);
    }

    // Stabilize: dedupe + sort so multi-answer phrasing is consistent
    indices = Array.from(new Set(indices)).sort((a, b) => a - b);

    // Multi-answer
    if (indices.length > 1) {
      question.type = QuestionType.MultipleAnswer;

      const optionsText =
        indices.length > 2
          ? `${indices.slice(0, -1).join(', ')} and ${indices.slice(-1)}`
          : indices.join(' and ');

      return `Options ${optionsText} are correct because ${e}`;
    }

    // Single-answer
    if (indices.length === 1) {
      question.type = QuestionType.SingleAnswer;
      return `Option ${indices[0]} is correct because ${e}`;
    }

    // Zero derived indices → just return the explanation (no scolding)
    return e;
  }

  private syncFormattedExplanationState(
    questionIndex: number,
    formattedExplanation: string,
  ): void {
    if (!this.formattedExplanations$[questionIndex]) {
      // Initialize the BehaviorSubject if it doesn't exist at the specified index
      this.formattedExplanations$[questionIndex] = new BehaviorSubject<
        string | null
      >(null);
    }

    // Access the BehaviorSubject at the specified questionIndex
    const subjectAtIndex = this.formattedExplanations$[questionIndex];

    if (subjectAtIndex) {
      subjectAtIndex.next(formattedExplanation);

      // Update the formattedExplanations array
      this.formattedExplanations[questionIndex] = {
        questionIndex,
        explanation: formattedExplanation,
      };
    } else {
      console.error(
        `No element at index ${questionIndex} in formattedExplanations$`,
      );
    }
  }

  getFormattedExplanation(questionIndex: number): Observable<string> {
    if (!this.explanationsInitialized) {
      return of('No explanation available');
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
      } catch { }
      console.log(
        `[ETS] 🧹 Cleared stale FET for previous Q${this._activeIndex + 1}`,
      );
    }

    // Now safely update active index to current question
    this._activeIndex = questionIndex;

    return this.getFormattedExplanationTextForQuestion(questionIndex).pipe(
      map((explanationText: string | null) => {
        const text = explanationText?.trim() || 'No explanation available';

        if (this._activeIndex !== questionIndex) {
          console.log(
            `[ETS] 🚫 Ignoring stale FET emission (incoming=${questionIndex}, active=${this._activeIndex})`,
          );
          return this.latestExplanation || 'No explanation available';
        }

        return text;
      }),
    );
  }

  public setIsExplanationTextDisplayed(
    isDisplayed: boolean,
    options: { force?: boolean; context?: string } = {},
  ): void {
    // Visibility lock: prevent overwrites during visibility restore
    if ((this as any)._visibilityLocked) {
      console.log('[ETS] ⏸ Ignored setIsExplanationTextDisplayed while locked');
      return;
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
      aggregated === this.isExplanationTextDisplayedSource.getValue()
    ) {
      return;
    }

    // Update the canonical BehaviorSubject
    this.isExplanationTextDisplayedSource.next(aggregated);

    // Also update a secondary Subject for legacy or parallel subscribers
    try {
      (this as any).isExplanationTextDisplayedSubject?.next(aggregated);
    } catch {
      // optional secondary push; ignore if missing
    }
  }

  public setShouldDisplayExplanation(
    shouldDisplay: boolean,
    options: { force?: boolean; context?: string } = {},
  ): void {
    // Visibility lock: prevent any reactive writes while restoring visibility
    if ((this as any)._visibilityLocked) {
      console.log('[ETS] ⏸ Ignored setShouldDisplayExplanation while locked');
      return;
    }

    const contextKey = this.normalizeContext(options.context);
    const signature = `${options.context ?? 'global'}:::${shouldDisplay}`;
    console.log(
      `[ETS] setShouldDisplayExplanation called with: ${shouldDisplay} (context: ${contextKey})`,
    );

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
      aggregated === this.shouldDisplayExplanationSource.getValue()
    ) {
      return;
    }

    // Normal reactive push (this is your main subject)
    this.shouldDisplayExplanationSource.next(aggregated);

    // Update Subject
    try {
      (this as any).shouldDisplayExplanationSubject?.next(aggregated);
    } catch {
      // Ignore — optional mirror stream
    }
  }

  public triggerExplanationEvaluation(): void {
    const currentExplanation = this.getLatestFormattedExplanation();
    const shouldShow = this.shouldDisplayExplanationSource.getValue();

    if (shouldShow && currentExplanation) {
      console.log(`[✅ Explanation Ready to Display]: "${currentExplanation}"`);
      this.explanationTrigger.next();
      this.setExplanationText(currentExplanation, {
        force: true,
        context: 'evaluation',
      });
    } else {
      console.warn(
        '[⏭️ triggerExplanationEvaluation] Skipped — Missing explanation or display flag',
      );
    }

    console.log('[✅ Change Detection Applied after Explanation Evaluation]');
  }

  private buildQuestionKey(
    questionText: string | null | undefined,
    index?: number,
  ): string | null {
    const normalizedText = (questionText ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

    if (!normalizedText && (index === undefined || index < 0)) {
      return null;
    }

    const indexPart =
      typeof index === 'number' && index >= 0 ? `|${index}` : '';
    return `${normalizedText}${indexPart}`;
  }

  private isQuestionValid(question: QuizQuestion): boolean {
    return (
      !!question &&
      !!question.questionText &&
      !this.processedQuestions.has(question.questionText)
    );
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
    this.explanationTextSubject.next('');
    this.setShouldDisplayExplanation(false, { force: true });
    this.setIsExplanationTextDisplayed(false, { force: true });

    this.isExplanationDisplayedSource.next(false);
  }

  resetStateBetweenQuestions(): void {
    this.resetExplanationState();
    this.resetProcessedQuestionsState();
  }

  resetExplanationState(): void {
    this.unlockExplanation();
    this.clearExplanationCaches();

    this.explanationTextSubject.next('');
    this.explanationText$.next('');
    this.formattedExplanationSubject.next('');

    this.shouldDisplayExplanationSource.next(false);
    this.isExplanationTextDisplayedSource.next(false);
    this.resetCompleteSubject.next(false);

    // FET is definitely NOT ready after a full reset
    try {
      this.qss.setExplanationReady(false);
    } catch { }
  }

  resetProcessedQuestionsState(): void {
    this.processedQuestions = new Set<string>();
  }

  setResetComplete(value: boolean): void {
    this.resetCompleteSubject.next(value);
  }

  public forceResetBetweenQuestions(): void {
    this.resetExplanationState();
  }

  private normalizeContext(context?: string | null): string {
    const normalized = (context ?? '').toString().trim();
    return normalized || this.globalContextKey;
  }

  private computeContextualFlag(map: Map<string, boolean>): boolean {
    for (const value of map.values()) {
      if (value) {
        return true;
      }
    }

    return false;
  }

  // Emit per-index formatted text; coalesces duplicates and broadcasts event
  public emitFormatted(index: number, value: string | null): void {
    // Lock immediately to prevent race conditions with reactive streams
    this._fetLocked = true;

    const token = this._currentGateToken;

    // ✅ RELAXED GUARDS: Allow emission if we have valid content
    // The lock check is removed because we now emit BEFORE locking in applyExplanationText
    if (this._gateToken !== token) {
      console.log(
        `[emitFormatted] Token mismatch: gate=${this._gateToken}, current=${token}`,
      );
    }

    if (index !== this._activeIndex) {
      console.log(
        `[emitFormatted] Index mismatch: active=${this._activeIndex}, requested=${index}`,
      );
    }

    const trimmed = (value ?? '').trim();
    if (!trimmed) {
      console.log(`[emitFormatted] No content to emit for Q${index + 1}`);
      return;
    }

    // ✅ Allow re-emission of same content if it's important (e.g., after navigation)
    if (trimmed === (this.latestExplanation ?? '').trim()) {
      console.log(
        `[emitFormatted] Same content, but emitting anyway for Q${index + 1}`,
      );
    }

    this.latestExplanation = trimmed;
    this.latestExplanationIndex = index;

    // Store in Map by index for reliable retrieval
    this.fetByIndex.set(index, trimmed);

    // ✅ CRITICAL: Also emit to formattedExplanationSubject for FINAL LAYER
    // This ensures getCombinedDisplayTextStream's combineLatest re-evaluates
    this.formattedExplanationSubject.next(trimmed);

    // ✅ Emit immediately without waiting for requestAnimationFrame
    // This ensures the FET is available synchronously for the display stream
    console.log(
      `[emitFormatted] ✅ Emitting FET for Q${index + 1}:`,
      trimmed.slice(0, 80),
    );
    this.safeNext(this._fetSubject, { idx: index, text: trimmed, token });
    this.safeNext(this.shouldDisplayExplanationSource, true);
    this.safeNext(this.isExplanationTextDisplayedSource, true);

    // At this point, FET is computed and “ready” for this question
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
    if (bs.getValue() !== next) bs.next(next); // coalesce
  }

  // Call to open a gate for an index
  public openExclusive(index: number, text: string): void {
    const token = this._currentGateToken;

    // Pre-guards
    if (
      this._fetLocked ||
      index !== this._activeIndex ||
      token !== this._gateToken
    ) {
      console.log(
        `[ETS] ⏸ openExclusive rejected (idx=${index}, active=${this._activeIndex}, token=${token}/${this._gateToken})`,
      );
      return;
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
      ) {
        console.log(`[ETS] 🚫 late openExclusive dropped for Q${index + 1}`);
        return;
      }
      this.safeNext(this.formattedExplanationSubject, trimmed);
      this.safeNext(this.shouldDisplayExplanation$, true);
      this.safeNext(this.isExplanationTextDisplayed$, true);

      // FET now open and visible for this index
      try {
        this.qss.setExplanationReady(true);
      } catch { }
    });
  }

  // Holds a per-question text$ stream (isolated subjects by index)
  private getOrCreate(index: number) {
    // Ensure a dedicated text$ stream exists for each question index
    let textEntry = this._textMap.get(index);
    if (!textEntry) {
      textEntry = { text$: new ReplaySubject<string>(1) };
      this._textMap.set(index, textEntry);
    }

    // Maintain compatibility with old BehaviorSubjects
    // for gate control and legacy code paths
    if (!this._byIndex.has(index)) {
      this._byIndex.set(index, new BehaviorSubject<string | null>(null));
    }

    if (!this._gate.has(index)) {
      this._gate.set(index, new BehaviorSubject<boolean>(false));
    }

    // Return the full set of subjects for this index
    // text$: isolated ReplaySubject stream for FET
    // gate$: per-index BehaviorSubject for display gating
    return {
      text$: textEntry.text$,
      gate$: this._gate.get(index)!,
    };
  }

  // Reset explanation state cleanly for a new index
  public resetForIndex(index: number): void {
    // Close previous
    // Only proceed if _activeIndex is a valid number (not null and not -1)
    if (
      this._activeIndex !== null &&
      this._activeIndex !== -1 &&
      this._activeIndex !== index
    ) {
      try {
        this._byIndex.get(this._activeIndex)?.next(null);
      } catch { }

      try {
        this._gate.get(this._activeIndex)?.next(false);
      } catch { }

      if (this.formattedExplanations) {
        delete this.formattedExplanations[this._activeIndex];
      }

      // Only clear global state when switching to a DIFFERENT question
      this.latestExplanation = '';
      this.latestExplanationIndex = null;
      this.formattedExplanationSubject?.next('');
      this.setShouldDisplayExplanation(false, { force: true });
      this.setIsExplanationTextDisplayed(false, { force: true });

      console.log(
        `[ETS] Cleared global state for question switch: ${this._activeIndex} -> ${index}`,
      );
    }

    // Ensure and hard-emit null/false for new index
    const { text$, gate$ } = this.getOrCreate(index);
    try {
      text$.next('');
    } catch { }
    try {
      gate$.next(false);
    } catch { }

    this._activeIndex = index;
    this.latestExplanationIndex = index; // Ensure FET guard can match for new question
    this.formattedExplanations[index] = {
      questionIndex: index,
      explanation: '',
    };
    console.log(`[ETS] resetForIndex(${index}) -> null/false`);

    try {
      this.qss.setExplanationReady(false);
    } catch { }
  }

  // Set readiness flag — true when navigation finishes and FET is cached
  public setReadyForExplanation(ready: boolean): void {
    this._readyForExplanation$.next(ready);
    console.log(`[ETS] ⚙️ setReadyForExplanation = ${ready}`);
  }

  public async waitUntilQuestionRendered(timeoutMs = 500): Promise<void> {
    try {
      await firstValueFrom(
        this.questionRendered$.pipe(
          filter((v) => v),
          take(1),
          timeout(timeoutMs),
        ),
      );
    } catch {
      // Swallow timeouts or interruptions silently
    }
  }

  public closeGateForIndex(index: number): void {
    const gate = this._gatesByIndex?.get(index);
    if (gate) {
      gate.next(false);
      console.log(`[ETS] Closed gate for Q${index + 1}`);
    }
  }

  public closeAllGates(): void {
    this._gatesByIndex.clear();
    this._fetLocked = null;

    try {
      this.setShouldDisplayExplanation(false, { force: true });
      this.setIsExplanationTextDisplayed(false);
    } catch (err) {
      console.warn('[ETS] Failed to close gates cleanly', err);
    }

    console.log('[ETS] All explanation gates closed');
  }

  public markLastNavTime(time: number): void {
    this._lastNavTime = time;
  }

  public setQuietZone(durationMs: number): void {
    const until = performance.now() + Math.max(0, durationMs);
    this._quietZoneUntil = until;
    this.quietZoneUntil$.next(until);
    console.log(
      `[ETS] ⏸ Quiet zone set for ${durationMs}ms (until=${until.toFixed(1)})`,
    );
  }

  public purgeAndDefer(newIndex: number): void {
    console.log(`[ETS ${this._instanceId}] 🔄 purgeAndDefer(${newIndex})`);

    // Bump generation and lock everything immediately
    this._gateToken++;
    this._currentGateToken = this._gateToken;
    this._activeIndex = newIndex;
    this._fetLocked = true;

    // Stop all lingering subjects to prevent replay from Q1
    try {
      if (this.formattedExplanationSubject) {
        this.formattedExplanationSubject.next('');
      }
    } catch { }
    // this.formattedExplanationSubject = new BehaviorSubject<string>(''); // ❌ DON'T REPLACE IT!
    this.formattedExplanation$ =
      this.formattedExplanationSubject.asObservable();

    // Hard reset every flag
    this.latestExplanation = '';
    this.setShouldDisplayExplanation(false);
    this.setIsExplanationTextDisplayed(false);
    this._textMap?.clear?.();

    // Navigation in progress → explanation not ready
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
        // If a newer purge happened while waiting, abort
        if (this._currentGateToken !== localToken) {
          console.log(
            `[ETS ${this._instanceId}] 🚫 stale unlock aborted for Q${newIndex + 1}`,
          );
          return;
        }

        // Token still current → unlock safely
        this._fetLocked = false;
        console.log(
          `[ETS ${this._instanceId}] 🔓 gate reopened cleanly for Q${newIndex + 1}`,
        );
      }, 120); // small delay lets purge settle visually
    });
  }

  // Helper
  private safeNext<T>(s: any, v: T) {
    if (s && typeof s.next === 'function') s.next(v);
  }
}
