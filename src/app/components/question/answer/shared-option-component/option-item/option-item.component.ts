import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, ViewEncapsulation, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatIconModule } from '@angular/material/icon';

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
export class OptionItemComponent implements OnChanges {
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

  // ONE output
  readonly optionUI = output<OptionUIEvent>();

  constructor(
    private optionService: OptionService,
    private quizService: QuizService,
    private selectedOptionService: SelectedOptionService,
    private selectionMessageService: SelectionMessageService
  ) { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['currentQuestionIndex']) {
      const nextQuestionIndex = Number(this.currentQuestionIndex() ?? -1);
      if (Number.isFinite(nextQuestionIndex) && nextQuestionIndex !== this._lastQuestionIndex) {
        // Only clear stale visual state when we're navigating AWAY from
        // a question the user actually clicked on inside this component
        // instance. On refresh the parent's questionIndex signal may
        // briefly emit the default 0 before settling on the real index,
        // which would otherwise wipe refresh-restored highlights on Q2+.
        // _userHasClicked gates the clear so restore-only transitions
        // leave the rehydrated binding state alone.
        if (this._lastQuestionIndex !== -1 && this._userHasClicked) {
          this._wasSelected = false;
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
    return (
      opt?.correct === true ||
      String(opt?.correct) === 'true' ||
      opt?.correct === 1 ||
      opt?.correct === '1' ||
      this.b?.isCorrect === true
    );
  }

  getOptionIcon(option?: any, i?: number): string {
    if (this.shouldShowFeedback() || this.shouldShowCorrectOnTimeout()) {
      return this.isOptionCorrect() ? 'check' : 'close';
    }
    return this.b.optionIcon || '';
  }

  getOptionClasses(): { [key: string]: boolean } {
    const classes = { ...this.b.cssClasses };

    if (this.timerExpired()) {
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
    // In single-answer mode, correct options must stay clickable until the
    // correct answer has been selected (so user can recover from a wrong pick).
    const optCorrectFlag = this.b?.option?.correct ?? (this.b?.option as any)?.isCorrect;
    const thisIsCorrect = optCorrectFlag === true || String(optCorrectFlag) === 'true' || optCorrectFlag === 1 || optCorrectFlag === '1';

    if (this.type() === 'single' && thisIsCorrect) {
      // Only disable this correct option if a correct answer was already selected
      const qIdx = this.currentQuestionIndex() ?? this.quizService.currentQuestionIndex;
      const clickConfirmed = this.selectedOptionService.clickConfirmedDotStatus.get(qIdx);
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

      // Resolve correct flags from canonical question (quizService.questions[qIdx])
      const canonicalQ: any = (this.quizService as any)?.questions?.[qIdx];
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
        // Lock self if NOT the selected one
        const selfSelected = filtered.some((s: any) => {
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

  shouldShowIcon(option?: any, i?: number): boolean {
    if (this.timerExpired()) {
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
    if (!this.timerExpired()) {
      return false;
    }

    // When the timer expires, reveal ALL correct answers regardless of whether
    // they were flagged for icons or highlighted before.
    return this.isOptionCorrect();
  }

  getOptionBackgroundColor(): string | null {
    if (this.timerExpired()) {
      if (this.shouldShowCorrectOnTimeout()) return '#43e756';
      // Keep the user's wrong selection red on timer expiry.
      const wasSelected = this.b?.isSelected
        || !!this.b?.option?.highlight
        || this._wasSelected
        || this.isSelectedForCurrentQuestion();
      return wasSelected && !this.isOptionCorrect() ? '#ff0000' : null;
    }

    if (!this.shouldHighlightOption()) {
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
    // NUCLEAR REFRESH GUARD: On refresh (no live click), bypass ALL
    // intermediate layers (binding state, _wasSelected, sharedOptionConfig)
    // and read sel_Q* directly. Only highlight if this option's TEXT appears
    // in the durable sessionStorage. This is immune to every init-path
    // contamination vector (processOptionBindings, generateOptionBindings,
    // rehydrateUiFromState, etc.).
    if (!this._userHasClicked) {
      const bText = (this.b?.option?.text ?? '').trim().toLowerCase();
      if (!bText) {
        return false;
      }
      let qIndex = this.currentQuestionIndex() ?? this.quizService.currentQuestionIndex;
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
      try {
        const raw = sessionStorage.getItem('sel_Q' + qIndex);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const found = parsed.some((s: any) => {
              const sText = ((s as any)?.text ?? '').trim().toLowerCase();
              return sText && sText === bText;
            });
            return found;
          }
        }
      } catch { /* ignore */ }
      return false;
    }

    // Sticky latch for live interaction
    if (this.b?.isSelected && !this._wasSelected) {
      this._wasSelected = true;
    }

    if (this.type() === 'multiple') {
      // For multi-answer, trust the sharedOptionConfig as the final authority.
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