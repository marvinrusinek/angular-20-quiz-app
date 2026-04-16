import { Injectable } from '@angular/core';
import {
  BehaviorSubject, combineLatest, Observable, of
} from 'rxjs';
import {
  distinctUntilChanged, filter, map, shareReplay, startWith, switchMap
} from 'rxjs/operators';

import { Option } from '../../../models/Option.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';
import { QuizService } from '../../data/quiz.service';
import { QuizNavigationService } from '../../flow/quiz-navigation.service';
import { QuizQuestionManagerService } from '../../flow/quizquestionmgr.service';
import { QuizStateService } from '../../state/quizstate.service';
import { SelectedOptionService } from '../../state/selectedoption.service';
import { ExplanationTextService, FETPayload } from '../explanation/explanation-text.service';

@Injectable({ providedIn: 'root' })
export class QuizContentDisplayService {
  // ═══════════════════════════════════════════════════════════════════════
  // FET State
  // ═══════════════════════════════════════════════════════════════════════

  // Lock flag to prevent displayText$ from overwriting FET
  _fetLocked = false;
  _lockedForIndex = -1;

  // Session-based tracking: which questions have had FET displayed this session
  _fetDisplayedThisSession = new Set<number>();

  _lastQuestionTextByIndex = new Map<number, string>();

  // ═══════════════════════════════════════════════════════════════════════
  // Reactive Observables (initialized via setup methods)
  // ═══════════════════════════════════════════════════════════════════════

  displayText$!: Observable<string>;
  shouldShowFet$!: Observable<boolean>;
  fetToDisplay$!: Observable<string>;

  constructor(
    private quizService: QuizService,
    private quizNavigationService: QuizNavigationService,
    private quizStateService: QuizStateService,
    private explanationTextService: ExplanationTextService,
    private quizQuestionManagerService: QuizQuestionManagerService,
    private selectedOptionService: SelectedOptionService
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  // Formatted Explanation Observables (factory methods)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Creates the reactive FET observable that combines the current index
   * with service cache updates to guarantee latest data.
   */
  createFormattedExplanation$(
    currentIndex$: Observable<number>
  ): Observable<FETPayload> {
    return combineLatest([
      currentIndex$,
      this.explanationTextService.explanationsUpdated
    ]).pipe(
      map(([idx, explanations]) => {
        const explanation = explanations[idx]?.explanation || '';
        return { idx, text: explanation, token: 0 } as FETPayload;
      }),
      distinctUntilChanged((a, b) => a.idx === b.idx && a.text === b.text),
      shareReplay(1)
    );
  }

  /**
   * Creates the active FET text observable that resolves from
   * both fetByIndex map and formattedExplanations record.
   */
  createActiveFetText$(
    currentIndex$: Observable<number>
  ): Observable<string> {
    return combineLatest([
      currentIndex$,
      this.explanationTextService.explanationsUpdated.pipe(startWith({}))
    ]).pipe(
      map(([idx]) => {
        const safeIdx = Number.isFinite(idx) ? Number(idx) : 0;
        const fromMap = this.explanationTextService.fetByIndex?.get(safeIdx)?.trim() || '';
        const fromRecord = this.explanationTextService.formattedExplanations?.[safeIdx]?.explanation?.trim() || '';
        return fromMap || fromRecord;
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Display Text Pipeline
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Builds the main displayText$ observable that switches between
   * question text and formatted explanation text based on resolution state.
   */
  initDisplayTextPipeline(
    currentIndex$: Observable<number>,
    timedOutIdx$: Observable<number>,
    displayState$: Observable<{ mode: 'question' | 'explanation'; answered: boolean }>
  ): void {
    this.displayText$ = currentIndex$.pipe(
      filter(idx => idx >= 0),
      switchMap(safeIdx => {
        return combineLatest([
          this.quizService.getQuestionByIndex(safeIdx),
          this.selectedOptionService.getSelectedOptionsForQuestion$(safeIdx).pipe(startWith([])),
          this.explanationTextService.getExplanationText$(safeIdx).pipe(startWith('')),
          timedOutIdx$.pipe(
            startWith(-1),
            map(tIdx => tIdx === safeIdx)
          ),
          displayState$.pipe(startWith({ mode: 'question', answered: false })),
          this.quizNavigationService.getIsNavigatingToPrevious().pipe(startWith(false)),
          this.quizStateService.userHasInteracted$.pipe(startWith(-1))
        ]).pipe(
          map(([qObj, selections, fetText, isTimedOut, state, isNavBack, lastInteractedIdx]) => {
            return this.resolveDisplayText(
              safeIdx, qObj, selections, fetText, isTimedOut, state, isNavBack, lastInteractedIdx
            );
          })
        );
      }),
      distinctUntilChanged()
    );
  }

  /**
   * Pure resolution logic: given all inputs for a question index,
   * determine what text to display (question text or FET).
   */
  private resolveDisplayText(
    safeIdx: number,
    qObj: QuizQuestion | null,
    selections: any[],
    fetText: string | null,
    isTimedOut: boolean,
    state: { mode: string; answered: boolean } | null,
    isNavBack: boolean,
    lastInteractedIdx: number
  ): string {
    const rawQText = qObj?.questionText || '';
    const serviceQText = (qObj?.questionText ?? '').trim();
    const effectiveQText = serviceQText || rawQText || '';

    // Build the base question text display (with multi-answer banner if applicable)
    let qDisplay = effectiveQText;
    // Use the raw, untouched questions array as the source of truth for the
    // correct-count. The qObj passed in here may have been mutated by upstream
    // services that OR-merge correct flags from prior state.
    const rawQuestion = (this.quizService as any)?.questions?.[safeIdx] as QuizQuestion | undefined;
    const sourceOpts = rawQuestion?.options ?? qObj?.options ?? [];
    const numCorrect = sourceOpts.filter((o: Option) => o?.correct === true).length;
    if (numCorrect > 1 && sourceOpts.length) {
      const banner = this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
        numCorrect,
        sourceOpts.length
      );
      qDisplay = `${qDisplay} <span class="correct-count">${banner}</span>`;
    }

    // AUTHORITATIVE RESOLUTION FOR THIS INDEX
    const safeSelections = Array.isArray(selections) ? selections : [];
    const isMultipleAnswer = numCorrect > 1;

    // Multi-answer resolution uses RAW source options so mutated qObj.options
    // with reduced correct flags can't make a 1-of-2 correct pick resolve true.
    let isResolved = false;
    if (qObj) {
      if (isMultipleAnswer) {
        const norm = (t: any) => String(t ?? '').trim().toLowerCase();
        const rawCorrectTexts = (sourceOpts as any[])
          .filter((o: any) => o?.correct === true || String(o?.correct) === 'true')
          .map((o: any) => norm(o?.text))
          .filter((t: string) => !!t);
        // Only count entries that are ACTIVELY selected right now.
        // `getSelectedOptionsForQuestion$` unions `_selectionHistory`
        // with `selected: false`, so past clicks would otherwise be
        // treated as current selections and falsely resolve the question
        // when only 1 of N correct answers is actually selected.
        const selTexts = new Set(
          (safeSelections as any[])
            .filter((s: any) => s?.selected === true)
            .map((s: any) => norm(s?.text))
            .filter((t: string) => !!t)
        );
        isResolved = rawCorrectTexts.length > 0 && rawCorrectTexts.every((t: string) => selTexts.has(t));
        console.log(`[displayText$] Q${safeIdx + 1} MULTI-resolution rawCorrect=${JSON.stringify(rawCorrectTexts)} selTexts=${JSON.stringify([...selTexts])} isResolved=${isResolved}`);
      } else {
        isResolved = this.selectedOptionService.isQuestionResolvedLeniently(qObj, safeSelections);
      }
    }

    // Was this question answered in a prior session (e.g. before a page
    // refresh)? The answered set is persisted to sessionStorage and
    // restored in QuizStateService's constructor, so this survives F5.
    // NOTE: This flag alone is NOT sufficient to show the FET — a
    // single-answer wrong click also marks a question "answered", but the
    // FET must only appear when ALL correct answers have been selected.
    // We keep it around for the nav-back hasPriorAnswer check below.
    const wasPreviouslyAnswered = this.quizStateService.isQuestionAnswered(safeIdx);

    // Allow FET only if the question is actually resolved (all correct
    // answers selected) OR the timer expired. Previously-answered alone
    // must not trigger FET — otherwise a wrong single-answer click that
    // survives a refresh would incorrectly show the explanation.
    let shouldShowExplanation = isResolved || isTimedOut;

    // CRITICAL GUARD: Only show FET if user has actively interacted with
    // this question in the current session. On a page refresh the in-memory
    // interaction set is empty, so we also accept the presence of restored
    // selections (safeSelections) OR a resolved state as proof of prior
    // interaction — both are persisted via sel_Q*/selectedOptionsMap.
    const hasInteracted =
      this.quizStateService.hasUserInteracted(safeIdx) ||
      lastInteractedIdx === safeIdx ||
      safeSelections.length > 0 ||
      isResolved;
    if (!hasInteracted && !isTimedOut) {
      shouldShowExplanation = false;
    }

    // When navigating backwards (Previous button), show question text
    // UNLESS the question was previously answered / resolved — in that
    // case we want the FET to persist so the user sees their prior result.
    const hasPriorAnswer = wasPreviouslyAnswered || isResolved || safeSelections.length > 0;
    if (isNavBack && !hasPriorAnswer) {
      shouldShowExplanation = false;
    }

    // DIRECT OIS BYPASS: If OIS has already confirmed all correct answers
    // are selected, trust it — but validate against pristine data first
    // to prevent false positives from mutated bindings.
    if (!shouldShowExplanation) {
      const perfectMap = (this.quizService as any)?._multiAnswerPerfect as Map<number, boolean> | undefined;
      if (perfectMap?.get(safeIdx) === true && hasInteracted) {
        // Validate: for multi-answer questions, confirm all correct are truly selected
        let oisBypassAllowed = true;
        try {
          const nrm2 = (t: any) => String(t ?? '').trim().toLowerCase();
          const bundle2: any[] = (this.quizService as any)?.quizInitialState ?? [];
          const qs2: any = this.quizService;
          const isShuf2 = qs2?.isShuffleEnabled?.() && Array.isArray(qs2?.shuffledQuestions) && qs2.shuffledQuestions.length > 0;
          const liveQ2: any = isShuf2 ? qs2?.shuffledQuestions?.[safeIdx] : qs2?.questions?.[safeIdx];
          const qText2 = nrm2(liveQ2?.questionText ?? qObj?.questionText ?? '');
          let pCorrect: string[] = [];
          for (const quiz of bundle2) {
            for (const pq of (quiz?.questions ?? [])) {
              if (nrm2(pq?.questionText) !== qText2) continue;
              pCorrect = (pq?.options ?? [])
                .filter((o: any) => o?.correct === true || String(o?.correct) === 'true')
                .map((o: any) => nrm2(o?.text)).filter((t: string) => !!t);
              break;
            }
            if (pCorrect.length > 0) break;
          }
          if (pCorrect.length >= 2) {
            const selNow2 = new Set<string>();
            for (const s of safeSelections) {
              if (s?.selected !== true) continue;
              const t = nrm2(s?.text);
              if (t) selNow2.add(t);
            }
            const liveOpts2: any[] = Array.isArray(liveQ2?.options) ? liveQ2.options : [];
            for (const o of liveOpts2) {
              if (o?.selected === true || o?.highlight === true || o?.showIcon === true) {
                const t = nrm2(o?.text);
                if (t) selNow2.add(t);
              }
            }
            if (!pCorrect.every(t => selNow2.has(t))) {
              oisBypassAllowed = false;
              perfectMap?.delete?.(safeIdx);
              console.warn(`[displayText$] Q${safeIdx + 1} OIS bypass BLOCKED — pristine shows multi-answer not fully resolved`);
            }
          }
        } catch { /* ignore */ }
        if (oisBypassAllowed) {
          shouldShowExplanation = true;
          console.log(`[displayText$] Q${safeIdx + 1} OIS bypass: _multiAnswerPerfect=true → forcing SHOW`);
        }
      }
    }

    if (!shouldShowExplanation && state?.mode === 'explanation' && safeSelections.length > 0 && hasInteracted) {
      // Only show FET when the question is actually resolved (correct answer selected).
      shouldShowExplanation = isResolved;
    }

    // FINAL HARD GUARD: authoritative check via hasClickedInSession.
    // This Set only grows on real user clicks or refresh-of-answered,
    // so it's immune to sessionStorage contamination affecting other
    // flags. If the user hasn't clicked this idx in this session and
    // it wasn't just timed out, force question text.
    const hasClickedThisIdx = this.quizStateService.hasClickedInSession?.(safeIdx) ?? false;
    if (shouldShowExplanation && !isTimedOut && !hasClickedThisIdx) {
      console.log(`[displayText$] Q${safeIdx + 1} ⛔ final hard guard: !hasClickedInSession → forcing question text`);
      shouldShowExplanation = false;
    }

    // ABSOLUTE PRISTINE GATE: re-validate multi-answer resolution
    // directly against pristine quizInitialState regardless of which
    // upstream flag flipped shouldShowExplanation to true. This closes
    // every path that can set the flag erroneously (isResolved,
    // _multiAnswerPerfect, explanation-mode override, etc.).
    if (shouldShowExplanation && !isTimedOut) {
      try {
        const nrm = (t: any) => String(t ?? '').trim().toLowerCase();
        const qs: any = this.quizService;
        const isShuffled = qs?.isShuffleEnabled?.()
          && Array.isArray(qs?.shuffledQuestions)
          && qs.shuffledQuestions.length > 0;
        const liveQForGate: any = isShuffled
          ? qs?.shuffledQuestions?.[safeIdx]
          : qs?.questions?.[safeIdx];
        const qText = nrm(liveQForGate?.questionText ?? qObj?.questionText ?? '');
        let pristineCorrect: string[] = [];
        const bundle: any[] = qs?.quizInitialState ?? [];
        for (const quiz of bundle) {
          for (const pq of quiz?.questions ?? []) {
            if (nrm(pq?.questionText) !== qText) continue;
            pristineCorrect = (pq?.options ?? [])
              .filter((o: any) => o?.correct === true || String(o?.correct) === 'true')
              .map((o: any) => nrm(o?.text))
              .filter((t: string) => !!t);
            break;
          }
          if (pristineCorrect.length > 0) break;
        }
        if (pristineCorrect.length >= 2) {
          const selectedNow = new Set<string>();
          // Active selections only
          for (const s of safeSelections) {
            if (s?.selected !== true) continue;
            const t = nrm(s?.text);
            if (t) selectedNow.add(t);
          }
          // Live question options
          const liveOpts: any[] = Array.isArray(liveQForGate?.options)
            ? liveQForGate.options
            : [];
          for (const o of liveOpts) {
            const isSel = o?.selected === true
              || o?.highlight === true
              || o?.showIcon === true;
            if (!isSel) continue;
            const t = nrm(o?.text);
            if (t) selectedNow.add(t);
          }
          const allSel = pristineCorrect.every(t => selectedNow.has(t));
          console.log(`[displayText$] Q${safeIdx + 1} ABSOLUTE pristine gate pristineCorrect=${JSON.stringify(pristineCorrect)} selected=${JSON.stringify([...selectedNow])} allSel=${allSel}`);
          if (!allSel) {
            console.warn(`[displayText$] Q${safeIdx + 1} ⛔ ABSOLUTE pristine gate BLOCK — FET suppressed`);
            shouldShowExplanation = false;
            // Also clear any falsely-set perfect flag so downstream
            // OIS-bypass can't re-trigger on the next emission.
            (this.quizService as any)?._multiAnswerPerfect?.delete?.(safeIdx);
          }
        }
      } catch { /* ignore */ }
    }

    const finalFet = (fetText ?? '').trim();
    const hasFet = finalFet.length > 0;
    const hasRaw = !!qObj?.explanation;

    const isFetForThisQuestion = hasFet && (
      this.explanationTextService.latestExplanationIndex === safeIdx ||
      (this.explanationTextService.formattedExplanations[safeIdx]?.explanation ?? '').trim() === finalFet ||
      (this.explanationTextService as any).fetByIndex?.get(safeIdx)?.trim() === finalFet ||
      finalFet.toLowerCase().includes('correct because')
    );

    // DIAGNOSTIC
    try {
      document.title = `DT Q${safeIdx} sel=${safeSelections.length} R=${isResolved?1:0} sSE=${shouldShowExplanation?1:0} hF=${hasFet?1:0} iFQ=${isFetForThisQuestion?1:0} hR=${hasRaw?1:0} NB=${isNavBack?1:0}`;
    } catch { /* ignore */ }

    if (shouldShowExplanation) {
      console.log(`[displayText$] Q${safeIdx + 1} DISPLAY: hasFet=${hasFet}, isValid=${isFetForThisQuestion}, hasRaw=${hasRaw}`);
      if (isFetForThisQuestion) {
        console.log(`[displayText$] Q${safeIdx + 1} showing FET: "${finalFet.slice(0, 40)}..."`);
        return finalFet;
      }
      // Before falling back to raw explanation, check formatted caches directly.
      // The reactive stream (fetText) may not have the formatted text yet due to
      // timing (e.g. resetExplanationState cleared _byIndex subjects), but the
      // formattedExplanations cache or fetByIndex may still have it.
      const cachedFet = (this.explanationTextService.formattedExplanations[safeIdx]?.explanation ?? '').trim()
        || ((this.explanationTextService as any).fetByIndex?.get(safeIdx) ?? '').trim();
      if (cachedFet && cachedFet.toLowerCase().includes('correct because')) {
        console.log(`[displayText$] Q${safeIdx + 1} showing CACHED FET: "${cachedFet.slice(0, 40)}..."`);
        return cachedFet;
      }
      if (hasRaw) {
        // Last resort: format the raw explanation on-the-fly with option #s
        const correctIndices = this.explanationTextService.getCorrectOptionIndices(
          qObj, qObj.options, safeIdx
        );
        if (correctIndices.length > 0) {
          const formatted = this.explanationTextService.formatExplanation(
            qObj, correctIndices, qObj.explanation
          );
          console.log(`[displayText$] Q${safeIdx + 1} ON-THE-FLY FET: "${formatted.slice(0, 40)}..."`);
          return formatted;
        }
        console.warn(`[displayText$] Q${safeIdx + 1} falling back to RAW: FET mismatch or missing`);
        return qObj.explanation || '';
      }
      // We WANT to show FET but no text is producible in this emission
      // (caches not yet populated after refresh). Try regenerating from
      // scratch using the raw question data so we don't have to fall back
      // to question text — that would cause the visible FET to flicker
      // back to the question on every stray emission.
      const regenerated = this.regenerateFetForIndex(safeIdx);
      if (regenerated) {
        console.log(`[displayText$] Q${safeIdx + 1} REGENERATED FET: "${regenerated.slice(0, 40)}..."`);
        return regenerated;
      }
      // Last resort: return empty string so the subscribeToDisplayText
      // guard preserves the previously cached FET in the DOM rather than
      // overwriting it with question text.
      console.warn(`[displayText$] Q${safeIdx + 1} shouldShowExplanation but no FET producible — returning empty to preserve cached`);
      return '';
    }

    return qDisplay;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Should Show FET
  // ═══════════════════════════════════════════════════════════════════════

  setupShouldShowFet(currentIndex$: Observable<number>): void {
    this.shouldShowFet$ = currentIndex$.pipe(
      filter(idx => idx >= 0),
      distinctUntilChanged(),
      switchMap((idx) =>
        combineLatest([
          this.quizService.getQuestionByIndex(idx).pipe(startWith(null)),
          this.selectedOptionService.getSelectedOptionsForQuestion$(idx).pipe(
            startWith([])
          )
        ]).pipe(
          map(([question, selected]: [QuizQuestion | null, any[]]) => {
            const resolved = question
              ? this.selectedOptionService.isQuestionResolvedCorrectly(
                question,
                selected ?? []
              )
              : false;

            console.log(`[shouldShowFet] Idx: ${idx}, Resolved: ${resolved}, Selected: ${selected?.length}`);
            return resolved;
          })
        )
      ),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FET To Display
  // ═══════════════════════════════════════════════════════════════════════

  setupFetToDisplay(
    currentIndex$: Observable<number>,
    timedOutIdx$: Observable<number>,
    activeFetText$: Observable<string>,
    currentQuestion: BehaviorSubject<QuizQuestion | null>
  ): void {
    const showOnTimeout$ = combineLatest([
      currentIndex$.pipe(startWith(-1)),
      timedOutIdx$.pipe(startWith(-1))
    ]).pipe(
      map(([idx, timedOutIdx]) => idx >= 0 && idx === timedOutIdx),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.fetToDisplay$ = combineLatest([
      activeFetText$.pipe(startWith('')),
      this.shouldShowFet$.pipe(startWith(false)),
      showOnTimeout$.pipe(startWith(false)),
      currentQuestion.pipe(startWith(null))
    ]).pipe(
      map(([fet, resolved, timedOut, question]) => {
        const text = (fet ?? '').trim();
        console.log(`[fetToDisplay$] Resolved: ${resolved}, TimedOut: ${timedOut}, FET len: ${text.length}`);

        // Allow display if: Resolved OR TimedOut
        if (resolved || timedOut) {
          if (text.length > 0) {
            return text;
          }
          // Fallback if formatted text is missing
          if (question && question.explanation) {
            console.warn('[fetToDisplay$] Using fallback raw explanation');
            return question.explanation;
          }
        }
        return '';
      }),

      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FET Regeneration
  // ═══════════════════════════════════════════════════════════════════════

  regenerateFetForIndex(idx: number): string {
    try {
      const displayQuestions = this.quizService.getQuestionsInDisplayOrder?.() ?? [];
      const question = displayQuestions[idx] ?? this.quizService.questions?.[idx];
      if (!question || !Array.isArray(question.options) || question.options.length === 0) {
        return '';
      }

      const rawExplanation = (question.explanation ?? '').trim();
      if (!rawExplanation) return '';

      this.explanationTextService.storeFormattedExplanation(
        idx,
        rawExplanation,
        question,
        question.options,
        true
      );

      return this.explanationTextService.fetByIndex?.get(idx)?.trim() || '';
    } catch {
      return '';
    }
  }
}
