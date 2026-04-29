import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, Input, OnChanges, OnInit, SimpleChanges, ViewEncapsulation, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatIconModule } from '@angular/material/icon';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { OptionBindings } from '../../../../../shared/models/OptionBindings.model';
import { FeedbackProps } from '../../../../../shared/models/FeedbackProps.model';
import { HighlightOptionDirective } from '../../../../../directives/highlight-option.directive';
import { SharedOptionConfigDirective } from '../../../../../directives/shared-option-config.directive';

import { correctAnswerAnim } from '../../../../../animations/animations';
import { OptionService } from '../../../../../shared/services/options/view/option.service';
import { SharedOptionConfig } from '../../../../../shared/models/SharedOptionConfig.model';
import { QuizService } from '../../../../../shared/services/data/quiz.service';
import { SelectedOptionService } from '../../../../../shared/services/state/selectedoption.service';
import { SelectionMessageService } from '../../../../../shared/services/features/selection-message/selection-message.service';
import { TimerService } from '../../../../../shared/services/features/timer/timer.service';

export type OptionUIEventKind = 'change' | 'interaction' | 'contentClick';

export interface OptionUIEvent {
  optionId: number;
  displayIndex: number;
  kind: OptionUIEventKind;
  inputType: 'radio' | 'checkbox';
  nativeEvent: any;
}

@Component({
  selector: 'app-option-item',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCheckboxModule,
    MatRadioModule,
    MatIconModule,
    HighlightOptionDirective,
    SharedOptionConfigDirective
  ],
  templateUrl: './option-item.component.html',
  styleUrls: ['./option-item.component.scss'],
  encapsulation: ViewEncapsulation.None,
  animations: [correctAnswerAnim],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OptionItemComponent implements OnChanges, OnInit {
  @Input() b!: OptionBindings;
  @Input() i!: number;
  readonly type = input<'single' | 'multiple'>('single');
  readonly form = input.required<FormGroup>();
  readonly shouldResetBackground = input(false);
  readonly feedbackConfig = input<FeedbackProps>();
  readonly sharedOptionConfig = input.required<SharedOptionConfig>();
  readonly currentQuestionIndex = input(0);
  readonly timerExpired = input(false);

  private _wasSelected = false;
  private _lastQuestionIndex = -1;
  // Tracks whether this component instance has seen a real user click.
  // Used to gate destructive visual-state clears in ngOnChanges: on
  // refresh the parent may briefly emit currentQuestionIndex=0 before
  // the real index resolves, and the second ngOnChanges would wipe the
  // refresh-restored state if we cleared unconditionally.
  private _userHasClicked = false;
  // Tracks whether the timer expired for the current question. Used to
  // clear timer-expiry highlighting on question change even when the
  // user never clicked an option (_userHasClicked is false).
  private _wasTimerExpired = false;
  // Direct timer expiry flag — set by subscribing to timerService.expired$
  // directly, bypassing the parent OnPush binding chain.
  private _directTimerExpired = false;
  private _directTimerExpiredForIndex = -1;

  private destroyRef = inject(DestroyRef);
  private cdRef = inject(ChangeDetectorRef);

  // ONE output
  readonly optionUI = output<OptionUIEvent>();

  constructor(
    private optionService: OptionService,
    private quizService: QuizService,
    private selectedOptionService: SelectedOptionService,
    private selectionMessageService: SelectionMessageService,
    private timerService: TimerService
  ) { }

  ngOnInit(): void {
    this.timerService.expired$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this._directTimerExpired = true;
        this._directTimerExpiredForIndex = this.timerService.expiredForQuestionIndex;
        this.cdRef.markForCheck();
        this.cdRef.detectChanges();
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['currentQuestionIndex']) {
      const nextQuestionIndex = Number(this.currentQuestionIndex() ?? -1);
      if (Number.isFinite(nextQuestionIndex) && nextQuestionIndex !== this._lastQuestionIndex) {
        // Clear stale visual state when navigating AWAY from a question.
        // Gate on _userHasClicked OR _wasTimerExpired so timer-expired
        // highlighting (correct answers revealed on timeout) is also
        // cleared when the user advances without having clicked.
        if (this._lastQuestionIndex !== -1 && (this._userHasClicked || this._wasTimerExpired)) {
          this._wasSelected = false;
          this._wasTimerExpired = false;
          this._directTimerExpired = false;
          this._directTimerExpiredForIndex = -1;
          if (this.b) {
            this.b.isSelected = false;
            this.b.disabled = false;
            this.b.cssClasses = {};
            if (this.b.option) {
              this.b.option.selected = false;
              this.b.option.highlight = false;
              this.b.option.showIcon = false;
            }
          }
          this._userHasClicked = false;
        }
        this._lastQuestionIndex = nextQuestionIndex;
      }
    }

    // Track timer expiry so we can clear highlighting on question change
    // even when the user never clicked an option.
    if (this.isTimerExpiredForThisQuestion() && !this._wasTimerExpired) {
      this._wasTimerExpired = true;
    }

    if (changes['shouldResetBackground'] && this.shouldResetBackground()) {
      this._wasSelected = false;
    }

    // Sticky: once selected, stays highlighted for the rest of the question.
    // GUARD: only latch during live interaction (_userHasClicked).
    // On refresh, transient init paths (processOptionBindings, generateOptionBindings)
    // can briefly set b.isSelected = true on options the user never clicked.
    // rehydrateUiFromState resets them, but ngOnChanges fires BEFORE rehydrate,
    // so _wasSelected would already be latched — causing ghost highlights
    // (e.g. 2nd correct answer in multi-answer). Gating on _userHasClicked
    // ensures only actual user clicks latch the highlight.
    if (this.b?.isSelected && this._userHasClicked) {
      this._wasSelected = true;
    }
  }

  /**
   * Authoritative timer-expired check: the `timerExpired` input may be
   * stale (set for Q1 but not yet cleared when Q2 renders). Cross-check
   * against TimerService.expiredForQuestionIndex so a stale input from
   * Q1 doesn't disable/highlight Q2's options.
   */
  private isTimerExpiredForThisQuestion(): boolean {
    const qIdx = this.currentQuestionIndex() ?? this.quizService.currentQuestionIndex;

    // Signal-based check: reading expiredForQuestionIndexSig() inside a
    // template-bound method lets Angular auto-track the dependency and
    // re-render this OnPush component when the signal changes.
    const expiredIdx = this.timerService.expiredForQuestionIndexSig();
    if (expiredIdx >= 0 && expiredIdx === qIdx) {
      return true;
    }

    // Direct subscription flag (belt-and-suspenders)
    if (this._directTimerExpired && this._directTimerExpiredForIndex === qIdx) {
      return true;
    }

    // Legacy fallback: parent input-based check
    if (!this.timerExpired()) {
      return false;
    }
    const expiredPlain = this.timerService.expiredForQuestionIndex;
    if (expiredPlain >= 0 && expiredPlain !== qIdx) {
      return false;
    }
    return true;
  }

  get optionId(): number {
    return (this.b?.option?.optionId != null && this.b.option.optionId !== -1)
      ? Number(this.b.option.optionId)
      : this.i;
  }

  private get inputType(): 'radio' | 'checkbox' {
    return this.type() === 'multiple' ? 'checkbox' : 'radio';
  }

  getOptionDisplayText(): string {
    return this.optionService.getOptionDisplayText(this.b.option, this.i);
  }

  private isOptionCorrect(): boolean {
    const opt = this.b?.option as any;
    if (
      opt?.correct === true ||
      String(opt?.correct) === 'true' ||
      opt?.correct === 1 ||
      opt?.correct === '1' ||
      this.b?.isCorrect === true
    ) {
      return true;
    }

    // Fallback: check authoritative question data from quiz service.
    // Binding options may lack the `correct` flag after regeneration.
    const qIdx = this.currentQuestionIndex() ?? this.quizService.currentQuestionIndex;
    const question = (this.quizService as any).questions?.[qIdx];
    if (question?.options && opt?.text) {
      const optText = (opt.text as string).trim().toLowerCase();
      const match = question.options.find(
        (o: any) => o?.text && (o.text as string).trim().toLowerCase() === optText
      );
      if (match?.correct === true || String(match?.correct) === 'true') {
        return true;
      }
    }

    return false;
  }

  getOptionIcon(option?: any, i?: number): string {
    if (this.isTimerStamped()) {
      return this.isStampedCorrect() ? 'check' : 'close';
    }
    if (this.shouldShowFeedback() || this.shouldShowCorrectOnTimeout()) {
      return this.isOptionCorrect() ? 'check' : 'close';
    }
    return this.b.optionIcon || '';
  }

  getOptionClasses(): { [key: string]: boolean } {
    const classes = { ...this.b.cssClasses };

    // If the timer-expiry handler pre-stamped CSS classes on this binding,
    // return them directly — do NOT let downstream logic overwrite them.
    if ((this.b as any)?._timerExpiredStamped) {
      return classes;
    }

    if (this.isTimerExpiredForThisQuestion()) {
      // Preserve the user's selected state on timer expiry: a selected
      // wrong option must still paint red with its close icon.
      const wasSelected = this.b?.isSelected
        || !!this.b?.option?.highlight
        || this._wasSelected
        || this.isSelectedForCurrentQuestion();
      const showCorrect = this.shouldShowCorrectOnTimeout();
      classes['correct-option'] = showCorrect;
      classes['incorrect-option'] = wasSelected && !this.isOptionCorrect();
      return classes;
    }

    const isCorrect = this.isOptionCorrect();
    const shouldHighlight = this.shouldHighlightOption();

    if (shouldHighlight) {
      if (isCorrect) {
        classes['correct-option'] = true;
        classes['incorrect-option'] = false;
      } else {
        classes['incorrect-option'] = true;
        classes['correct-option'] = false;
      }
    } else {
      // Explicitly clear all highlight classes to prevent stale cssClasses from leaking
      classes['correct-option'] = false;
      classes['incorrect-option'] = false;
      classes['highlighted'] = false;
      classes['selected'] = false;
      classes['selected-option'] = false;
    }

    return classes;
  }

  getOptionCursor(): string {
    return this.b.optionCursor || 'default';
  }

  isDisabled(): boolean {
    // Timer-expiry handler stamped all bindings as disabled
    if (this.isTimerStamped()) {
      return true;
    }

    const _type = this.type();
    const _qIdx = this.currentQuestionIndex() ?? this.quizService.currentQuestionIndex;

    // For MULTIPLE mode, NEVER disable unless the question is definitively
    // fully answered or the timer expired. This prevents stale b.disabled
    // from initialization (when isMultiMode wasn't yet true) from blocking clicks.
    if (_type === 'multiple') {
      if (this.isTimerExpiredForThisQuestion()) {
        return true;
      }
      const perfectMap = (this.quizService as any)?._multiAnswerPerfect as Map<number, boolean> | undefined;
      const isFullyAnswered = perfectMap?.get(_qIdx) === true;
      if (isFullyAnswered && this.b?.disabled === true) {
        return true;
      }
      // Multi-answer options are NEVER disabled before the question is fully answered
      return false;
    }

    // In single-answer mode, correct options must stay clickable until the
    // correct answer has been selected (so user can recover from a wrong pick).
    const optCorrectFlag = this.b?.option?.correct ?? (this.b?.option as any)?.isCorrect;
    const thisIsCorrect = optCorrectFlag === true || String(optCorrectFlag) === 'true' || optCorrectFlag === 1 || optCorrectFlag === '1';

    if (thisIsCorrect) {
      // Only disable this correct option if a correct answer was already selected
      const clickConfirmed = this.selectedOptionService.clickConfirmedDotStatus.get(_qIdx);
      if (clickConfirmed !== 'correct') {
        return false;
      }
    }

    if (this.b?.disabled === true) return true;

    // SINGLE-ANSWER GUARD: if any sibling selection for the current question
    // is correct, lock every non-selected option. Strictly question-scoped via
    // questionIndex on the selection record, so navigation cannot leak.
    if (this.type() === 'single') {
      const qIdx = this.currentQuestionIndex() ?? this.quizService.currentQuestionIndex;
      let selections = this.selectedOptionService.getSelectedOptionsForQuestion(qIdx) ?? [];
      if (selections.length === 0) {
        selections = this.selectedOptionService.getRefreshBackup(qIdx);
      }
      // Durable fallback: on navigate-away-and-back, single-answer clicks
      // may have trimmed the in-memory map to just the last click (or
      // cleared it entirely). The per-question sessionStorage key still
      // holds the merged history from saveState(), which is what we need
      // here to detect that a correct answer was already chosen so the
      // unclicked siblings stay locked (dark gray).
      // IMPORTANT: only read this fallback inside isDisabled() — do NOT
      // expose it through getSelectedOptionsForQuestion, otherwise the
      // highlight path would also see these entries and paint red on
      // the unclicked option.
      if (selections.length === 0) {
        try {
          const raw = sessionStorage.getItem('sel_Q' + qIdx);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
              selections = parsed as any[];
            }
          }
        } catch { /* ignore */ }
      }
      const filtered = selections.filter((s: any) => {
        const sQ = s?.questionIndex ?? s?.qIdx ?? s?.questionIdx;
        return sQ === undefined || sQ === null || sQ === -1 || Number(sQ) === Number(qIdx);
      });
      if (filtered.length === 0) return false;

      // Resolve correct flags from canonical question (use display order for shuffled mode)
      const isShuffled = this.quizService?.isShuffleEnabled?.()
        && Array.isArray((this.quizService as any)?.shuffledQuestions)
        && (this.quizService as any)?.shuffledQuestions?.length > 0;
      const canonicalQ: any = isShuffled
        ? (this.quizService as any)?.getQuestionsInDisplayOrder?.()?.[qIdx]
          ?? (this.quizService as any)?.shuffledQuestions?.[qIdx]
        : (this.quizService as any)?.questions?.[qIdx];
      const canonicalOpts: any[] = canonicalQ?.options ?? [];
      const isCorrectFlag = (v: any) => v === true || String(v) === 'true' || v === 1 || v === '1';

      const anyCorrectSelected = filtered.some((s: any) => {
        const sIdx = s?.displayIndex ?? s?.index ?? s?.idx;
        const sId = s?.optionId;
        // Match by canonical index
        if (typeof sIdx === 'number' && sIdx >= 0) {
          const co = canonicalOpts[sIdx];
          if (co && isCorrectFlag(co.correct ?? co.isCorrect)) return true;
        }
        // Or by id
        if (sId != null) {
          const co = canonicalOpts.find((o: any) => o?.optionId === sId);
          if (co && isCorrectFlag(co.correct ?? co.isCorrect)) return true;
        }
        // Or by selection record's own flag
        if (isCorrectFlag(s?.correct ?? s?.isCorrect)) return true;
        return false;
      });

      if (anyCorrectSelected) {
        // Lock self if NOT the currently-selected one.
        // Prev-clicked entries (selected:false + showIcon:true + highlight:true)
        // must NOT count as self-selected here — they represent the user's
        // earlier wrong click that should now render dark gray/disabled after
        // the correct answer has been chosen.
        const selfSelected = filtered.some((s: any) => {
          if (s?.selected === false) return false;
          const sIdx = s?.displayIndex ?? s?.index ?? s?.idx;
          if (typeof sIdx === 'number' && sIdx === this.i) return true;
          const sId = s?.optionId;
          if (sId != null && this.b?.option?.optionId != null && String(sId) === String(this.b.option.optionId)) return true;
          return false;
        });
        return !selfSelected;
      }
    }

    return false;
  }

  /** True when the timer-expiry handler pre-stamped this binding. */
  private isTimerStamped(): boolean {
    return !!(this.b as any)?._timerExpiredStamped;
  }

  /** True when this binding was stamped as a correct option by the timer handler. */
  private isStampedCorrect(): boolean {
    return this.isTimerStamped() && this.b?.cssClasses?.['correct-option'] === true;
  }

  shouldShowIcon(option?: any, i?: number): boolean {
    if (this.isTimerStamped()) {
      if (this.isStampedCorrect()) return true;
      return !!this.b?.isSelected || this._wasSelected;
    }
    if (this.isTimerExpiredForThisQuestion()) {
      // Show icon for correct options AND for any option the user
      // actually selected (so a selected wrong answer keeps its X).
      if (this.shouldShowCorrectOnTimeout()) return true;
      return this.b?.isSelected
        || !!this.b?.option?.highlight
        || this._wasSelected
        || this.isSelectedForCurrentQuestion();
    }

    // HARD GUARD: On refresh (user hasn't clicked), ONLY trust the
    // authoritative saved selection state. The binding flags
    // (highlight, showIcon, isSelected) can be transiently set by
    // processOptionBindings / synchronizeOptionBindings before
    // rehydrate clears them, causing a flash. _wasSelected is only
    // true after a live user click, so it's safe.
    if (!this._userHasClicked && !this._wasSelected) {
      // During LIVE interaction (user clicked a sibling, not this option),
      // the click pipeline (OIS/OUS/SOC backstop) authoritatively sets
      // b.option.showIcon=false on non-clicked, non-history options.
      // Trust that flag to prevent service-level false positives from
      // effectiveId collisions or stale entries.
      // On refresh/initial-load, showIcon is typically undefined (not
      // explicitly false), so the service check below still runs.
      if (this.b?.option?.showIcon === false) {
        return false;
      }
      // No live click this session → only show icon if a saved
      // selection actually matches this exact binding position.
      return this.isSelectedForCurrentQuestion();
    }

    const hasAnyPerBindingSignal =
      this.b?.option?.showIcon === true
      || this.b?.isSelected === true
      || !!this.b?.option?.highlight
      || this._wasSelected;
    if (!hasAnyPerBindingSignal) {
      if (this.b?.disabled === true) return false;
      if (!this.isSelectedForCurrentQuestion()) return false;
    }

    return this.shouldHighlightOption();
  }

  shouldShowCorrectOnTimeout(): boolean {
    if (!this.isTimerExpiredForThisQuestion()) {
      return false;
    }

    // When the timer expires, reveal ALL correct answers regardless of whether
    // they were flagged for icons or highlighted before.
    return this.isOptionCorrect();
  }

  getOptionBackgroundColor(): string | null {
    // Timer-expiry handler stamped this binding — use stamped classes for color
    if (this.isTimerStamped()) {
      if (this.isStampedCorrect()) return '#43e756';
      const wasSelected = this.b?.isSelected || this._wasSelected;
      return wasSelected && !this.isStampedCorrect() ? '#ff0000' : null;
    }
    if (this.isTimerExpiredForThisQuestion()) {
      if (this.shouldShowCorrectOnTimeout()) return '#43e756';
      // Keep the user's wrong selection red on timer expiry.
      const wasSelected = this.b?.isSelected
        || !!this.b?.option?.highlight
        || this._wasSelected
        || this.isSelectedForCurrentQuestion();
      return wasSelected && !this.isOptionCorrect() ? '#ff0000' : null;
    }

    const _sh = this.shouldHighlightOption();
    if (!_sh) {
      // Dark gray for disabled unselected options (e.g. remaining
      // incorrect after all correct answers selected in multi-answer)
      if (this.b?.disabled && !this.b?.isSelected) {
        return '#a0a0a0';
      }
      // Also check _multiAnswerPerfect directly for the case where
      // the binding disabled flag is set and all correct are selected
      if (this.type() === 'multiple' && !this.b?.isSelected) {
        const perfectMap = (this.quizService as any)?._multiAnswerPerfect as Map<number, boolean> | undefined;
        const _qIdx = this.currentQuestionIndex() ?? this.quizService.currentQuestionIndex;
        if (perfectMap?.get(_qIdx) === true && !this.isOptionCorrect()) {
          return '#a0a0a0';
        }
      }
      return null;
    }

    // Green if correct, red if incorrect
    return this.isOptionCorrect() ? '#43e756' : '#ff0000';
  }

  private getSelectionsForCurrentBinding(): any[] {
    let qIndex = this.currentQuestionIndex() ?? this.quizService.currentQuestionIndex;

    // On page refresh, the input signal and quiz service may both
    // still be 0 (BehaviorSubject default) before the route resolver
    // updates them with the URL-derived index. Fall back to the URL
    // so saved selections for Q2+ are found on first render.
    if (qIndex === 0) {
      try {
        const m = window.location.pathname.match(/\/question\/[^/]+\/(\d+)/);
        if (m) {
          const urlIdx = Number(m[1]) - 1;
          if (Number.isFinite(urlIdx) && urlIdx > 0) {
            qIndex = urlIdx;
          }
        }
      } catch { /* ignore */ }
    }

    const selections = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];
    if (selections.length > 0) {
      return selections;
    }
    // Visual-only fallback: check refresh backup for highlight/disable state
    return this.selectedOptionService.getRefreshBackup(qIndex);
  }

  private matchesBindingSelection(sel: any): boolean {
    let qIndex =
      this.currentQuestionIndex() ?? this.quizService.currentQuestionIndex;

    // Same URL fallback as getSelectionsForCurrentBinding — on refresh
    // the input may still be 0 before the route resolves.
    if (qIndex === 0) {
      try {
        const m = window.location.pathname.match(/\/question\/[^/]+\/(\d+)/);
        if (m) {
          const urlIdx = Number(m[1]) - 1;
          if (Number.isFinite(urlIdx) && urlIdx > 0) {
            qIndex = urlIdx;
          }
        }
      } catch { /* ignore */ }
    }

    const selQIdx =
      sel.questionIndex ?? (sel as any).qIdx ?? (sel as any).questionIdx;

    // Strict Question Context Check
    if (selQIdx !== undefined && selQIdx !== null && selQIdx !== -1) {
      if (Number(selQIdx) !== qIndex) {
        return false;
      }
    }

    // Saved record must represent an actual selection. `selected: false`
    // is an unselect trace — ignore it so a never-clicked binding that
    // happens to share an index with an unselect entry never lights up.
    // EXCEPTION: entries with explicit showIcon/highlight are previously-
    // clicked wrong options saved by the correct-click handler — they
    // MUST match so the red+X icon restores on refresh.
    if (sel?.selected === false && !sel?.showIcon && !sel?.highlight) {
      return false;
    }

    // TEXT MATCH (most reliable — immune to synthetic ID mismatches
    // and index collisions from different init paths).
    const selText = ((sel as any)?.text ?? '').trim().toLowerCase();
    const bText = (this.b?.option?.text ?? '').trim().toLowerCase();
    if (selText && bText) {
      return selText === bText;
    }

    // Prefer `displayIndex` — that's what setSelectedOption enriches with
    // and it is stable across refresh. `sel.index` can be a stale legacy
    // field with an unrelated value (e.g. an array position), causing a
    // false positive against this binding's `this.i`. Fall back to
    // `index`/`idx` only when displayIndex is missing.
    const rawIdx =
      sel?.displayIndex ?? (sel as any)?.index ?? (sel as any)?.idx;
    const normalizedSelectedIndex =
      rawIdx != null && Number.isFinite(Number(rawIdx))
        ? Number(rawIdx)
        : null;

    if (normalizedSelectedIndex != null) {
      if (normalizedSelectedIndex !== this.i) {
        return false;
      }
      // Position matches — cross-check optionId to prevent false
      // positives when options reload in a different order or when
      // stale displayIndex values leak from a prior session.
      const selId = sel?.optionId;
      const bId = this.b?.option?.optionId;
      const selIdIsReal =
        selId != null && selId !== -1 && String(selId) !== '-1';
      const bIdIsReal =
        bId != null && bId !== -1 && String(bId) !== '-1';
      if (selIdIsReal && bIdIsReal && String(selId) !== String(bId)) {
        return false;
      }
      return true;
    }

    // Fallback: match by optionId only when no index data exists on the
    // selection record (e.g. refresh-backup data after deserialization).
    // Require a real, non-sentinel id on BOTH sides so that multiple
    // bindings sharing a -1/null optionId don't all match the same record.
    const selId = sel?.optionId;
    const bId = this.b?.option?.optionId;
    const selIdIsReal =
      selId != null && selId !== -1 && String(selId) !== '-1';
    const bIdIsReal =
      bId != null && bId !== -1 && String(bId) !== '-1';
    if (selIdIsReal && bIdIsReal && String(selId) === String(bId)) {
      return true;
    }

    return false;
  }

  shouldShowFeedback(): boolean {
    if (this.isTimerStamped()) return true;
    return this.shouldHighlightOption() || this.shouldShowCorrectOnTimeout();
  }

  onChanged(event: any): void {
    this._userHasClicked = true;
    this.optionUI.emit({
      optionId: this.optionId,
      displayIndex: this.i,
      kind: 'change',
      inputType: this.inputType,
      nativeEvent: event
    });
  }

  onContentClick(event: MouseEvent): void {
    event.stopPropagation();  // prevents double firing with parent (click)
    this._userHasClicked = true;
    this.optionUI.emit({
      optionId: this.optionId,
      displayIndex: this.i,
      kind: 'contentClick',
      inputType: this.inputType,
      nativeEvent: event
    });
  }

  shouldHighlightOption(): boolean {
    // Catch in-place mutations from rehydrateUiFromState that bypass
    // ngOnChanges (same object reference, no @Input change detected).
    // Only latch if (a) the user has actually clicked, or (b) the
    // binding's selection is confirmed by authoritative saved state.
    // Without the guard, transient b.isSelected from stale option.selected
    // data latches _wasSelected and bypasses the refresh guard below.
    if (this.b?.isSelected && !this._wasSelected) {
      if (this._userHasClicked || this.isSelectedForCurrentQuestion()) {
        this._wasSelected = true;
      }
    }

    // On refresh (no live click), ONLY trust authoritative saved
    // selection state — not binding flags which can be transiently
    // stale from processOptionBindings / hydrateOptions / setOptionBindingsIfChanged.
    if (!this._userHasClicked && !this._wasSelected) {
      // During live interaction, trust the binding's highlight flag
      // when explicitly false — prevents service-level false positives.
      if (this.b?.option?.highlight === false) {
        return false;
      }
      return this.isSelectedForCurrentQuestion();
    }

    if (this.type() === 'multiple') {
      // For multi-answer, trust the sharedOptionConfig as the final authority.
      // The config uses the durableSet (actual user clicks) to determine
      // highlight eligibility. Without this guard, transient binding state
      // from intermediate change-detection cycles can latch _wasSelected
      // on options the user never clicked (e.g. the 2nd correct answer).
      const cfg = this.sharedOptionConfig();
      if (cfg?.option && !cfg.option.highlight && !cfg.isOptionSelected) {
        return false;
      }
      return this.isOptionIndividuallySelected() || !!this.b.option?.highlight ||
        this._wasSelected;
    }
    return this.b.isSelected || !!this.b.option?.highlight || this._wasSelected
      || this.isSelectedForCurrentQuestion();
  }

  private isOptionIndividuallySelected(): boolean {
    return (
      this.b.isSelected ||
      this.b.checked ||
      this.b.option?.selected === true ||
      this.isSelectedForCurrentQuestion()
    );
  }

  private isSelectedForCurrentQuestion(): boolean {
    const selections = this.getSelectionsForCurrentBinding();
    return selections.some((s: any) => this.matchesBindingSelection(s));
  }
}