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

    // Preserve sessionStorage-restored interaction state across F5 refresh.
    // `_hasUserInteracted` is restored by quizStateService.restoreInteractionState()
    // when performance.navigation.type === 'reload' — wiping it here would undo
    // that and break FET display after refresh.
    let isPageRefresh = false;
    try {
      const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      isPageRefresh = navEntries.length > 0 && navEntries[0].type === 'reload';
    } catch { /* ignore */ }
    if (!isPageRefresh) {
      host.quizStateService._hasUserInteracted?.clear();
    }
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

    // Build the intended qText HTML for the current index. Centralised so
    // the visibility handler, replay retries, and the MutationObserver
    // safety net all derive the same value.
    const computeIntendedQText = (): string => {
      const idx = host.currentIndex >= 0
        ? host.currentIndex
        : (host.quizService.getCurrentQuestionIndex?.() ?? 0);
      let intended = '';
      const hasInteracted = this.hasInteractionEvidence(host, idx);
      if (hasInteracted) {
        // Check FET caches first
        const cachedFet =
          (host.explanationTextService.formattedExplanations?.[idx]?.explanation ?? '').trim()
          || ((host.explanationTextService as any).fetByIndex?.get(idx) ?? '').trim();
        if (cachedFet) {
          intended = cachedFet;
        }
        // No cached FET — try on-the-fly if quiz data is available
        if (!intended) {
          try {
            const questions = host.quizService.getQuestionsInDisplayOrder?.()
              ?? host.quizService.questions;
            const q = questions?.[idx];
            if (q?.explanation && q?.options?.length > 0) {
              // Check resolution to decide FET vs question text
              const isResolved = this.isQuestionResolvedFromStorage(host, idx);
              if (isResolved) {
                const correctIndices = host.explanationTextService.getCorrectOptionIndices(q, q.options, idx);
                if (correctIndices.length > 0) {
                  intended = host.explanationTextService.formatExplanation(q, correctIndices, q.explanation);
                }
              } else {
                // Unresolved (partial multi-answer) — show question text
                intended = this.buildQuestionDisplayHTML(host, idx);
              }
            }
          } catch { /* ignore */ }
          // If quiz data isn't loaded yet, return '' — loadQuestion
          // will handle it once data is available.
          if (!intended) {
            return '';
          }
        }
      }
      if (!intended) {
        intended = this.buildQuestionDisplayHTML(host, idx);
      }
      if (!intended) {
        intended = (host._lastDisplayedText ?? '').trim();
      }
      if (!intended) {
        try {
          const q = host.quizService.questions?.[idx];
          intended = (q?.questionText ?? '').trim();
        } catch {}
      }
      return intended;
    };
    host._cqcComputeIntendedQText = computeIntendedQText;

    const forceStampIfBlank = (reason: string): void => {
      const el = host.qText?.nativeElement;
      if (!el) return;
      const current = (el.innerHTML ?? '').trim();
      const intended = computeIntendedQText();
      if (!intended) return;
      if (!current || current !== intended) {
        this.writeQText(host, intended);
        console.log(`[CQCC qText] 🔁 Force-stamped (${reason})`);
      }
    };

    // Persistent MutationObserver safety net. The SCSS rule
    // `h3:empty { display: none }` means any transient blank collapses
    // the heading, and some restore paths (tab visibility, async
    // emissions) clear qText without routing through a path we control.
    // Watch qText forever and debounced-restore when it goes empty:
    //   - 80ms debounce lets intentional navigation blanks (runQuestionIndexSet)
    //     be overwritten by stampQuestionTextNow's own retry array before
    //     we try to intervene.
    //   - If it's STILL empty after the debounce, restore `_lastDisplayedText`
    //     (or recompute via the builder) so the user never sees a collapsed heading.
    try {
      const el = host.qText?.nativeElement;
      if (el && typeof MutationObserver !== 'undefined') {
        if (host._qTextObserver) {
          try { host._qTextObserver.disconnect(); } catch { /* ignore */ }
          host._qTextObserver = null;
        }
        let debounceTimer: any = null;
        const observer = new MutationObserver(() => {
          const innerNow = (el.innerHTML ?? '').trim();
          if (innerNow) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            const innerLater = (el.innerHTML ?? '').trim();
            if (innerLater) return;
            // Prefer whatever was last successfully displayed — that's
            // the most recent truth for this index. Fall back to a fresh
            // compute only if the cache is empty.
            let restore = (host._lastDisplayedText ?? '').trim();
            if (!restore) {
              restore = computeIntendedQText();
            }
            if (restore) {
              this.writeQText(host, restore);
              console.log('[CQCC qText] 🔁 Observer restored blank heading');
            }
          }, 80);
        });
        observer.observe(el, { childList: true, characterData: true, subtree: true });
        host._qTextObserver = observer;
      }
    } catch { /* ignore */ }

    host._cqcVisibilityHandler = () => {
      if (document.visibilityState !== 'visible') return;
      // Replay at several points to win races with the QQC visibility-restore
      // flow (which runs async with ~350ms + 400ms setTimeouts and may
      // overwrite or clear the qText DOM).
      forceStampIfBlank('visibility:0');
      setTimeout(() => forceStampIfBlank('visibility:100'), 100);
      setTimeout(() => forceStampIfBlank('visibility:500'), 500);
      setTimeout(() => forceStampIfBlank('visibility:900'), 900);
      setTimeout(() => forceStampIfBlank('visibility:1200'), 1200);
      setTimeout(() => forceStampIfBlank('visibility:2000'), 2000);
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
    if (host._qTextObserver) {
      try { host._qTextObserver.disconnect(); } catch { /* ignore */ }
      host._qTextObserver = null;
    }
    if (Array.isArray(host._questionStampRetryTimers)) {
      for (const t of host._questionStampRetryTimers) clearTimeout(t);
      host._questionStampRetryTimers = [];
    }
    host.destroy$.next();
    host.destroy$.complete();
    host.correctAnswersTextSource.complete();
    host.correctAnswersDisplaySubject.complete();
    host.combinedTextSubject.complete();
    host.combinedSub?.unsubscribe();
  }

  /**
   * Write HTML to qText. Updates the host signal (which the template is
   * bound to via [innerHTML]) AND the imperative Renderer2 mirror AND the
   * _lastDisplayedText cache. The signal is the durable source of truth
   * for Angular's change detection — writing it means visibility flips
   * and async restores can't leave the heading blank, because CD will
   * keep re-stamping from the signal on every pass. The Renderer2 write
   * remains for immediate synchronous DOM visibility inside the same
   * microtask (before CD has had a chance to run).
   */
  private writeQText(host: Host, html: string): void {
    try {
      const safe = html ?? '';
      host.qTextHtmlSig?.set(safe);
      host._lastDisplayedText = safe;
      const el = host.qText?.nativeElement;
      if (el) {
        host.renderer.setProperty(el, 'innerHTML', safe);
      }
    } catch { /* ignore */ }
  }

  /**
   * Build the question display HTML for a given index. Shuffled-aware —
   * reads from host.quizService.shuffledQuestions when shuffle is on,
   * otherwise host.quizService.questions. Adds the "select N" banner
   * for multi-answer questions.
   *
   * Returns '' if the question can't be resolved yet (too early in init).
   */
  private buildQuestionDisplayHTML(host: Host, idx: number): string {
    try {
      const isShuffled = host.quizService.isShuffleEnabled?.()
        && Array.isArray(host.quizService.shuffledQuestions)
        && host.quizService.shuffledQuestions.length > 0;
      const q = isShuffled
        ? host.quizService.shuffledQuestions[idx]
        : host.quizService.questions?.[idx];
      const rawQ = (q?.questionText ?? '').trim();
      if (!rawQ) return '';
      const sourceOpts = q?.options ?? [];
      const numCorrect = sourceOpts.filter((o: Option) => o?.correct === true).length;
      let display = rawQ;
      if (numCorrect > 1 && sourceOpts.length) {
        try {
          const banner = host.quizQuestionManagerService.getNumberOfCorrectAnswersText(
            numCorrect, sourceOpts.length
          );
          display = `${rawQ} <span class="correct-count">${banner}</span>`;
        } catch { /* ignore */ }
      }
      return display;
    } catch {
      return '';
    }
  }

  /**
   * Does this index have concrete evidence that FET should be showing?
   *
   * Authoritative source: `quizStateService.hasClickedInSession(idx)`.
   * This Set only grows on actual user click events (via
   * quiz-setup.service.onOptionSelected) and on refresh-of-an-answered
   * question (seeded for the refresh-initial URL idx only). It is immune
   * to sessionStorage contamination that affects the other state maps
   * (hasUserInteracted / isQuestionAnswered / selectedOptionsMap).
   */
  private hasInteractionEvidence(host: Host, idx: number): boolean {
    try {
      return !!host.quizStateService.hasClickedInSession?.(idx);
    } catch {
      return false;
    }
  }

  /** Check if the question at idx is fully resolved (all correct answers
   *  selected) based on persisted sessionStorage / in-memory state.
   *  Used to distinguish "should show FET" from "should show question text"
   *  for questions with partial interaction (e.g. 1-of-2 correct in multi). */
  private isQuestionResolvedFromStorage(host: Host, idx: number): boolean {
    try {
      let storedSelections: any[] = [];
      try {
        const raw = sessionStorage.getItem('sel_Q' + idx);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) storedSelections = parsed;
        }
      } catch { /* ignore */ }
      if (storedSelections.length === 0) {
        storedSelections =
          host.selectedOptionService.getSelectedOptionsForQuestion?.(idx) ?? [];
      }
      if (storedSelections.length > 0) {
        const questions = host.quizService.getQuestionsInDisplayOrder?.()
          ?? host.quizService.questions;
        const q = questions?.[idx];
        if (q) {
          return host.selectedOptionService.isQuestionResolvedLeniently?.(q, storedSelections)
            ?? false;
        }
      }
    } catch { /* ignore */ }
    return false;
  }

  /**
   * Unconditionally stamp the question text for idx into qText. Used by
   * runQuestionIndexSet on every navigation to guarantee the user sees
   * the question text before any FET / pipeline emission arrives. Safe
   * to retry — idempotent for a given idx+currentIndex.
   *
   * Returns true if the stamp was written, false otherwise.
   */
  private stampQuestionTextNow(host: Host, idx: number): boolean {
    try {
      if (host.currentIndex !== idx) return false;
      // Don't clobber an explicit FET that the user has already earned
      // for this very index (e.g. refresh-initial index with restored
      // answered state, or the user just clicked and the FET is live).
      // Bail on interaction evidence alone — loadQuestion (which runs
      // AFTER quiz data is fetched) handles the resolved-vs-unresolved
      // distinction and will stamp question text for partial multi-answer.
      if (this.hasInteractionEvidence(host, idx)) {
        return false;
      }
      const el = host.qText?.nativeElement;
      if (!el) return false;
      const display = this.buildQuestionDisplayHTML(host, idx);
      if (!display) return false;
      this.writeQText(host, display);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * If the current browser nav is a page refresh AND the target idx
   * differs from the index we refreshed on, wipe all stale restored
   * state for the target idx so downstream pipelines treat it as fresh.
   * Idempotent — safe to call from multiple entry points.
   */
  private cleanupStaleStateForIndex(host: Host, idx: number): void {
    try {
      let isPageRefresh = false;
      try {
        const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
        isPageRefresh = navEntries.length > 0 && navEntries[0].type === 'reload';
      } catch { /* ignore */ }

      if (!isPageRefresh) return;

      // Derive the refresh-initial index from the URL the FIRST time we
      // see any index after a refresh. Previously we trusted whatever
      // idx was passed on the first call — but if the component's
      // questionIndex signal briefly emits 0 before the parent route
      // resolves to the real value (e.g. 1 for Q2), we'd latch
      // _refreshInitialIdx=0 and then treat the real Q2 call as a
      // post-refresh sibling navigation, wiping Q2's restored
      // selections/highlights on page reload.
      if (host._refreshInitialIdx == null) {
        let urlIdx: number | null = null;
        try {
          const match = (window?.location?.pathname ?? '').match(/\/question\/[^/]+\/(\d+)/);
          if (match && match[1]) {
            const oneBased = parseInt(match[1], 10);
            if (Number.isFinite(oneBased) && oneBased >= 1) {
              urlIdx = oneBased - 1;
            }
          }
        } catch { /* ignore */ }
        host._refreshInitialIdx = urlIdx ?? idx;
        // If the URL-derived refresh index matches this idx, bail — no cleanup.
        if (host._refreshInitialIdx === idx) return;
        // Otherwise fall through: this call is a sibling idx, clean it up.
      }

      if (host._refreshInitialIdx === idx) return;

      // Only cleanup each idx once per session — otherwise if user
      // navigates away and back we'd erase their real interaction state.
      if (!host._postRefreshCleanedIndices) {
        host._postRefreshCleanedIndices = new Set<number>();
      }
      if (host._postRefreshCleanedIndices.has(idx)) return;
      host._postRefreshCleanedIndices.add(idx);

      // We're navigating post-refresh to a sibling index — clear every
      // source that resolveDisplayText or subscribeToDisplayText could
      // consult and find stale "answered" / "has FET" evidence for the
      // new index.
      try {
        host.quizStateService._hasUserInteracted?.delete(idx);
        host.quizStateService._answeredQuestionIndices?.delete(idx);
        (host.quizStateService as any).persistInteractionState?.();
      } catch { /* ignore */ }
      try {
        host.selectedOptionService.selectedOptionsMap?.delete(idx);
        (host.selectedOptionService as any)._refreshBackup?.delete(idx);
      } catch { /* ignore */ }
      try {
        host.quizService.selectedOptionsMap?.delete(idx);
      } catch { /* ignore */ }
      try {
        sessionStorage.removeItem(`sel_Q${idx}`);
      } catch { /* ignore */ }
      try {
        host.explanationTextService.fetByIndex?.delete(idx);
        delete (host.explanationTextService.formattedExplanations as any)[idx];
      } catch { /* ignore */ }
      // Reset the global displayState subject so combineLatest doesn't
      // replay Q<refreshIdx>'s {mode:'explanation', answered:true} into
      // the new emission for this idx.
      try {
        host.quizStateService.setDisplayState({ mode: 'question', answered: false }, { force: true });
      } catch { /* ignore */ }
      console.log(`[cleanupStaleStateForIndex] Q${idx + 1} cleared post-refresh stale state`);
    } catch { /* ignore */ }
  }

  runQuestionIndexSet(host: Host, idx: number): void {
    host.currentIndex = idx;
    host._fetLocked = false;
    host._lockedForIndex = -1;
    host.timedOutIdxSubject.next(-1);

    // NOTE: Do NOT cancel host._eagerFetRetryTimers here — the eager-FET
    // retry timers from loadQuestion carry their own closure-index guard
    // (they no-op if host.currentIndex changes), and cancelling them here
    // would wipe Q2's refresh-recovery retries whenever this method
    // re-enters for the same idx during init.

    // Reset cached display text so the empty-emission guard in
    // subscribeToDisplayText doesn't re-stamp the previous question's
    // FET onto this freshly loaded one. Skip the blank when there's
    // interaction evidence — loadQuestion will inject FET (resolved)
    // or stamp question text (unresolved) once quiz data is available.
    if (!this.hasInteractionEvidence(host, idx)) {
      host._lastDisplayedText = '';
      host.qTextHtmlSig?.set('');
    }

    // POST-REFRESH STALE-STATE CLEANUP: clear restored state for the
    // target idx if we're navigating to a sibling after a refresh.
    // Must run BEFORE host.questionIndexSubject.next(idx) so displayText$
    // re-emits with a clean slate for the new index.
    this.cleanupStaleStateForIndex(host, idx);

    // UNIVERSAL DIRECT QUESTION-TEXT STAMP: every time we switch indices,
    // immediately stamp the target question's text into qText. This is
    // the single source of truth for "the question text should show by
    // default"; any FET stamp must earn its spot by having interaction
    // evidence (eager FET in loadQuestion, or pipeline post-user-click).
    // Skipped automatically if the user has interaction evidence for this
    // idx (e.g. refresh-initial index with restored answered state).
    const stamped = this.stampQuestionTextNow(host, idx);
    if (!stamped && host.qText?.nativeElement && !this.hasInteractionEvidence(host, idx)) {
      // Question data wasn't ready — blank for now; retries below will
      // re-try once the questions array is populated.
      this.writeQText(host, '');
    }

    // Retry stamps to beat async rewriters (visibility handler, pipeline
    // emissions, nav-resolver). Each retry bails out if currentIndex has
    // changed or interaction evidence appeared (user clicked an answer).
    if (!Array.isArray(host._questionStampRetryTimers)) {
      host._questionStampRetryTimers = [];
    }
    for (const t of host._questionStampRetryTimers) clearTimeout(t);
    host._questionStampRetryTimers = [];
    const delays = [0, 50, 150, 400, 900];
    for (const d of delays) {
      host._questionStampRetryTimers.push(
        setTimeout(() => this.stampQuestionTextNow(host, idx), d)
      );
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
        // Reset to -1 (not idx) so subscribeToDisplayText's isExplanation
        // substitution check (`latestExplanationIndex === currentIndex`)
        // can't fire for this fresh index. Setting it to idx here caused
        // Q3 to receive an on-the-fly formatted FET after post-refresh
        // navigation from a refreshed Q2.
        ets.latestExplanationIndex = -1;
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
    if (!host.questionToDisplay$()) return;
    combineLatest([
      host.questionToDisplay$().pipe(startWith(''), distinctUntilChanged()),
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

          // Only substitute a FET if the user has concrete interaction
          // evidence for THIS index. Authoritative source is
          // quizStateService.hasClickedInSession — see hasInteractionEvidence.
          // The other state maps are contaminated by sessionStorage restore
          // and caused Q2 to flash between question text and FET after
          // navigating from a refreshed Q1.
          const currentIdx = host.currentIndex;
          const hasRealInteraction = this.hasInteractionEvidence(host, currentIdx);
          const isResolvedForGuard = hasRealInteraction
            ? this.isQuestionResolvedFromStorage(host, currentIdx)
            : false;

          const isExplanation = lowerText.length > 0
            && !isQuestionText
            && !lowerText.includes('correct because')
            && host.explanationTextService.latestExplanationIndex === host.currentIndex
            && host.explanationTextService.latestExplanationIndex >= 0
            && hasRealInteraction;
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
          } else if (!isQuestionText && !lowerText.includes('correct because')
                     && host.explanationTextService.latestExplanationIndex === host.currentIndex
                     && !hasRealInteraction) {
            // Diagnostic: substitution was suppressed because the user has
            // not actually interacted with this question (e.g. post-refresh
            // navigation to a sibling index).
            console.log(`[subscribeToDisplayText] ⛔ FET substitution suppressed for Q${currentIdx + 1} — no interaction evidence`);
          }

          const el = host.qText?.nativeElement;
          if (el) {
            // Guard against blanking the DOM when displayText$ momentarily
            // emits an empty string (common after tab visibility restore,
            // when combineLatest sources re-fire with stale/null values).
            const incoming = (finalText ?? '').trim();
            const cached = (host._lastDisplayedText ?? '').trim();
            if (!incoming) {
              if (cached) {
                console.warn('[subscribeToDisplayText] ⚠️ Empty text after restore — keeping cached');
                this.writeQText(host, cached);
                return;
              }
              // Cached is also empty — rebuild question text from scratch
              // rather than let an empty innerHTML reach the DOM (which is
              // what leaves the heading blank after a tab visibility flip).
              // BUT: skip the rebuild ONLY when the question is both
              // interacted AND resolved — loadQuestion will inject FET.
              // For partial multi-answer, rebuild question text.
              if (!hasRealInteraction || !isResolvedForGuard) {
                try {
                  const rebuilt = this.buildQuestionDisplayHTML(host, currentIdx);
                  if (rebuilt) {
                    this.writeQText(host, rebuilt);
                    console.warn('[subscribeToDisplayText] ⚠️ Empty text + empty cache — rebuilt question text');
                    return;
                  }
                } catch { /* ignore */ }
              }
              // Nothing to write — leave existing DOM untouched.
              return;
            }

            // UNIVERSAL QUESTION-FIRST GUARD: every question must start by
            // showing its question text. If the user has NOT interacted
            // with the current index (no clicks, no answer, no selections),
            // force the question text regardless of what the pipeline
            // emitted. Any FET stamp attempt on an un-interacted index is
            // treated as a leak from stale state. Shuffled-aware via
            // buildQuestionDisplayHTML helper.
            if (!hasRealInteraction) {
              try {
                const forcedQText = this.buildQuestionDisplayHTML(host, currentIdx);
                if (forcedQText) {
                  const isShuffled = host.quizService.isShuffleEnabled?.()
                    && Array.isArray(host.quizService.shuffledQuestions)
                    && host.quizService.shuffledQuestions.length > 0;
                  const qForCurrent = isShuffled
                    ? host.quizService.shuffledQuestions[currentIdx]
                    : host.quizService.questions?.[currentIdx];
                  const rawQ = (qForCurrent?.questionText ?? '').trim();
                  const incomingStartsWithQ = incoming.length > 0 && incoming.startsWith(rawQ);
                  if (!incomingStartsWithQ) {
                    console.warn(
                      `[subscribeToDisplayText] 🛡️ question-first guard Q${currentIdx + 1} — forcing question text over "${incoming.slice(0, 40)}"`
                    );
                    this.writeQText(host, forcedQText);
                    return;
                  }
                }
              } catch (e) {
                console.warn('[subscribeToDisplayText] question-first guard failed', e);
              }
            }

            // FET-OVER-QUESTION-TEXT GUARD: when the user has interaction
            // evidence, the question is RESOLVED, and the pipeline emits
            // question text (not FET), check FET caches before writing.
            // After resetExplanationState clears latestExplanationIndex,
            // the isExplanation check above fails and the pipeline falls
            // through with question text — this would overwrite the eager
            // FET that loadQuestion just injected. Only applies to resolved
            // questions; unresolved (partial multi-answer) should show qText.
            if (hasRealInteraction && isQuestionText && isResolvedForGuard) {
              const fetCached =
                (host.explanationTextService.formattedExplanations[currentIdx]?.explanation ?? '').trim()
                || ((host.explanationTextService as any).fetByIndex?.get(currentIdx) ?? '').trim();
              if (fetCached && fetCached.toLowerCase().includes('correct because')) {
                this.writeQText(host, fetCached);
                console.log(`[subscribeToDisplayText] 🛡️ FET-over-qText guard Q${currentIdx + 1} — wrote cached FET over question text`);
                return;
              }
              // No cached FET yet — loadQuestion's eager injection hasn't
              // run or hasn't called storeFormattedExplanation yet. Skip
              // writing question text so the DOM keeps whatever the eager
              // injection already placed there.
              const domNow = (el.innerHTML ?? '').trim();
              if (domNow && domNow.toLowerCase().includes('correct because')) {
                console.log(`[subscribeToDisplayText] 🛡️ FET-over-qText guard Q${currentIdx + 1} — DOM already has FET, skipping qText write`);
                return;
              }
            }

            this.writeQText(host, finalText);
            console.log(`[subscribeToDisplayText] ✅ Updated innerHTML via signal+Renderer2: "${finalText?.substring(0, 50)}..."`);
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
        host.setQuizId(quizId);
        host.quizService.quizId = quizId;
        host.quizService.setQuizId(quizId);
        localStorage.setItem('quizId', quizId);
        host.currentQuestionIndexValue = zeroBasedIndex;

        // Restore the persisted score now that the quizId is known.
        // QuizService's constructor ran this too, but with an empty quizId,
        // which is a no-op. On page refresh, this call is what actually
        // rehydrates correctCount / questionCorrectness from localStorage.
        try {
          host.quizService.scoringService?.restoreScoreFromPersistence?.(quizId);
        } catch { /* ignore */ }

        // IMPORTANT: set currentIndex BEFORE cleanup so the guard check
        // in subscribeToDisplayText sees the new index.
        host.currentIndex = zeroBasedIndex;

        // Post-refresh stale-state cleanup BEFORE we emit the new index —
        // otherwise displayText$ re-emits synchronously with whatever
        // leftover state Q<refreshIdx> left behind (mode='explanation',
        // pre-cached FET, etc.) and stamps FET onto the new question.
        this.cleanupStaleStateForIndex(host, zeroBasedIndex);

        // Universal direct question-text stamp — see runQuestionIndexSet
        // for rationale. Skipped automatically if this idx has real
        // interaction evidence (refresh-initial index).
        this.stampQuestionTextNow(host, zeroBasedIndex);
        // Retry stamps to beat any async rewriter.
        if (!Array.isArray(host._questionStampRetryTimers)) {
          host._questionStampRetryTimers = [];
        }
        for (const t of host._questionStampRetryTimers) clearTimeout(t);
        host._questionStampRetryTimers = [];
        const routeDelays = [0, 50, 150, 400, 900];
        for (const d of routeDelays) {
          host._questionStampRetryTimers.push(
            setTimeout(() => this.stampQuestionTextNow(host, zeroBasedIndex), d)
          );
        }

        host.questionIndexSubject.next(zeroBasedIndex);

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

        host.explanationTextService.resetExplanationState();
        host.explanationTextService.resetExplanationText();

        host.quizService.setCurrentQuestion(question);

        // Cancel any pending FET-injection retries from a previous
        // loadQuestion call — otherwise a stale Q2 retry could stamp
        // Q2's FET onto Q3 once the user navigates forward.
        if (Array.isArray(host._eagerFetRetryTimers)) {
          for (const t of host._eagerFetRetryTimers) clearTimeout(t);
        }
        host._eagerFetRetryTimers = [];

        // REFRESH RECOVERY: If this question was previously answered
        // (sessionStorage-persisted interaction), eagerly regenerate the
        // FET and inject it into the DOM so the user sees it immediately.
        // Without this, the async displayText$ pipeline often loses the
        // race against runQuestionIndexSet's DOM blanking, leaving the
        // question text blank after F5.
        try {
          let isPageRefresh = false;
          try {
            const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
            isPageRefresh = navEntries.length > 0 && navEntries[0].type === 'reload';
          } catch { /* ignore */ }
          // Only the VERY FIRST loadQuestion call after a refresh should
          // treat "this is a refresh" as evidence that FET should show.
          // Subsequent loadQuestion calls in the same page session are
          // driven by Next/Previous navigation and must NOT inherit FET.
          if (host._refreshInitialLoadConsumed == null) {
            host._refreshInitialLoadConsumed = false;
          }
          const isInitialLoadAfterRefresh = isPageRefresh && !host._refreshInitialLoadConsumed;
          if (isInitialLoadAfterRefresh) {
            // Remember the index we refreshed on so that future navigation
            // to a different index can clear stale restored state.
            host._refreshInitialIdx = zeroBasedIndex;
          }
          host._refreshInitialLoadConsumed = true;

          // POST-REFRESH NAVIGATION CLEANUP: If this loadQuestion is for
          // an index OTHER than the refresh-initial index, we're
          // navigating to a fresh question after Q<refreshIdx>'s FET
          // was displayed. Clear any sessionStorage-restored interaction/
          // answered/selection state for THIS new index so that
          // resolveDisplayText treats it as fresh and shows its question
          // text instead of inheriting FET flags from a prior play session.
          const isPostRefreshNavToDifferentIdx =
            isPageRefresh
            && typeof host._refreshInitialIdx === 'number'
            && host._refreshInitialIdx !== zeroBasedIndex;
          if (isPostRefreshNavToDifferentIdx) {
            // State cleanup is now handled earlier by cleanupStaleStateForIndex
            // (called from runQuestionIndexSet + runLoadQuizDataFromRoute),
            // which also directly stamps the question text into qText so
            // the user sees it immediately. Repeating the deletes here is
            // redundant but harmless. We do NOT blank the DOM here
            // anymore — that would erase the question text that
            // cleanupStaleStateForIndex just stamped.
            try {
              host.quizStateService._hasUserInteracted?.delete(zeroBasedIndex);
              host.quizStateService._answeredQuestionIndices?.delete(zeroBasedIndex);
              (host.quizStateService as any).persistInteractionState?.();
            } catch { /* ignore */ }
            try {
              host.selectedOptionService.selectedOptionsMap?.delete(zeroBasedIndex);
            } catch { /* ignore */ }
            try {
              sessionStorage.removeItem(`sel_Q${zeroBasedIndex}`);
            } catch { /* ignore */ }
            try {
              host.explanationTextService.fetByIndex?.delete(zeroBasedIndex);
              delete (host.explanationTextService.formattedExplanations as any)[zeroBasedIndex];
            } catch { /* ignore */ }
            console.log(`[loadQuestion] Q${zeroBasedIndex + 1} post-refresh nav → cleared stale interaction state`);
          }

          const ets = host.explanationTextService;
          // Authoritative evidence: hasClickedInSession. The seed on
          // construction adds the refresh-initial URL idx iff it was
          // answered in sessionStorage, so that covers F5 recovery for
          // the starting question. All other evidence paths are ignored
          // to prevent sessionStorage contamination from causing FET
          // to show on siblings.
          const hasClicked = host.quizStateService.hasClickedInSession?.(zeroBasedIndex) ?? false;

          // RESOLUTION GATE: The clickedInSession seed fires on refresh for
          // ANY answered question — including a single-answer wrong click
          // that marked the question as "answered" without resolving it.
          // The FET must only appear once all correct answers are actually
          // selected. Read the persisted selections and check resolution
          // against the loaded question.
          let isResolvedFromPersistence = false;
          try {
            let storedSelections: any[] = [];
            try {
              const raw = sessionStorage.getItem('sel_Q' + zeroBasedIndex);
              if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) storedSelections = parsed;
              }
            } catch { /* ignore */ }
            if (storedSelections.length === 0) {
              storedSelections =
                host.selectedOptionService.getSelectedOptionsForQuestion?.(zeroBasedIndex)
                ?? [];
            }
            if (storedSelections.length > 0 && question) {
              isResolvedFromPersistence =
                host.selectedOptionService.isQuestionResolvedLeniently?.(question, storedSelections)
                ?? false;
            }
          } catch { /* ignore */ }

          console.log(`[loadQuestion] Q${zeroBasedIndex + 1} refresh-recovery check: initialLoadAfterRefresh=${isInitialLoadAfterRefresh} hasClickedInSession=${hasClicked} hasExplanation=${!!question?.explanation} isResolvedFromPersistence=${isResolvedFromPersistence}`);
          const shouldInject = hasClicked && !!question?.explanation && isResolvedFromPersistence;
          if (shouldInject) {
            const correctIndices = ets.getCorrectOptionIndices(question, question.options, zeroBasedIndex);
            if (correctIndices.length > 0) {
              const formattedFet = ets.formatExplanation(question, correctIndices, question.explanation);
              if (formattedFet) {
                const injectNow = () => {
                  // Abort if the user has navigated away from this index —
                  // otherwise a retry would stamp the previous question's
                  // FET onto the newly loaded question.
                  if (host.currentIndex !== zeroBasedIndex) {
                    return;
                  }
                  // SURGICAL injection: only populate the PER-INDEX FET cache
                  // (so the displayText$ pipeline finds it on its own) and
                  // write directly to the DOM. Do NOT push onto global
                  // subjects (formattedExplanationSubject, explanationText$,
                  // setDisplayState, latestExplanationIndex) — those leak
                  // state onto the next question and cause its pipeline to
                  // display stale data.
                  try {
                    ets.storeFormattedExplanation(zeroBasedIndex, question.explanation, question, question.options, true);
                  } catch { /* ignore */ }
                  this.writeQText(host, formattedFet);
                  console.log(`[loadQuestion] Q${zeroBasedIndex + 1} eager FET injected: "${formattedFet.slice(0, 40)}..."`);
                };
                // Initial injection
                injectNow();
                // Retry injections to win races against any async code that
                // overwrites the DOM (displayText$ pipeline, runQuestionIndexSet
                // blanking, visibility handlers, etc.). Each retry bails out
                // if the user has navigated to a different question. Timer
                // handles are registered on host._eagerFetRetryTimers so they
                // can be cancelled when a new loadQuestion fires.
                if (!Array.isArray(host._eagerFetRetryTimers)) {
                  host._eagerFetRetryTimers = [];
                }
                host._eagerFetRetryTimers.push(setTimeout(injectNow, 0));
                host._eagerFetRetryTimers.push(setTimeout(injectNow, 50));
                host._eagerFetRetryTimers.push(setTimeout(injectNow, 200));
                host._eagerFetRetryTimers.push(setTimeout(injectNow, 500));
                host._eagerFetRetryTimers.push(setTimeout(injectNow, 1000));
              }
            } else {
              console.warn(`[loadQuestion] Q${zeroBasedIndex + 1} no correct indices found — cannot format FET`);
            }
          }

          // UNRESOLVED BUT INTERACTED: the user clicked on this question
          // but didn't select all correct answers (e.g. partial multi-answer
          // or single-answer wrong click). stampQuestionTextNow bailed on
          // interaction evidence, so nothing is displayed yet. Now that quiz
          // data IS available, stamp question text explicitly.
          if (hasClicked && !isResolvedFromPersistence) {
            const display = this.buildQuestionDisplayHTML(host, zeroBasedIndex);
            if (display && host.currentIndex === zeroBasedIndex) {
              this.writeQText(host, display);
              console.log(`[loadQuestion] Q${zeroBasedIndex + 1} interacted but unresolved — stamped question text`);
            }
          }
        } catch (e) {
          console.warn(`[loadQuestion] Q${zeroBasedIndex + 1} eager FET regeneration failed:`, e);
        }
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
    host.setQuizId(params.get('quizId') ?? '');
    const qid = host.quizId();
    if (!qid) {
      console.warn('No quizId provided in the parameters.');
      return of([[], []] as [QuizQuestion[], string[]]);
    }

    return forkJoin([
      host.quizDataService.getQuestionsForQuiz(qid).pipe(
        catchError((error: Error) => {
          console.error('Error fetching questions:', error);
          return of([] as QuizQuestion[]);
        })
      ),
      host.quizDataService.getAllExplanationTextsForQuiz(qid).pipe(
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

    host.setCombinedQuestionData$(combineLatest([
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
    ));
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
          Array.isArray(host.questions()) && index >= 0
            ? (host.questions()[index] ?? null)
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
