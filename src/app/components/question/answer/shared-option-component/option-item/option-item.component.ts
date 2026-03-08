import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges, ViewEncapsulation } from '@angular/core';
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
  animations: [correctAnswerAnim]
})
export class OptionItemComponent implements OnChanges {
  @Input() b!: OptionBindings;
  @Input() i!: number;
  @Input() type: 'single' | 'multiple' = 'single';
  @Input() form!: FormGroup;
  @Input() shouldResetBackground = false;
  @Input() feedbackConfig?: FeedbackProps;
  @Input() sharedOptionConfig!: SharedOptionConfig;
  @Input() currentQuestionIndex = 0;
  @Input() timerExpired = false;

  private _wasSelected = false;
  private _lastQuestionIndex = -1;

  // inputs removed in favor of OptionBindings snapshot


  // ✅ ONE output
  @Output() optionUI = new EventEmitter<OptionUIEvent>();

  constructor(
    private optionService: OptionService,
    private quizService: QuizService,
    private selectedOptionService: SelectedOptionService
  ) { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['b']) {
      // Keep previous selection sticky for the same question so earlier picks
      // remain highlighted even if transient binding snapshots flip false.
      const selectedNow = this.isSelectedForCurrentQuestion() || !!this.b?.isSelected;
      this._wasSelected = this._wasSelected || selectedNow;
    }

    if (changes['currentQuestionIndex']) {
      const nextQuestionIndex = Number(this.currentQuestionIndex ?? -1);
      if (Number.isFinite(nextQuestionIndex) && nextQuestionIndex !== this._lastQuestionIndex) {
        this._wasSelected = this.isSelectedForCurrentQuestion() || !!this.b?.isSelected;
        this._lastQuestionIndex = nextQuestionIndex;
      }
    }

    if (changes['shouldResetBackground'] && this.shouldResetBackground) {
      this._wasSelected = false;
    }

    if (this.isSelectedForCurrentQuestion()) {
      this._wasSelected = true;
    }
  }

  get optionId(): number {
    return (this.b?.option?.optionId != null && this.b.option.optionId !== -1)
      ? Number(this.b.option.optionId)
      : this.i;
  }

  private get inputType(): 'radio' | 'checkbox' {
    return this.type === 'multiple' ? 'checkbox' : 'radio';
  }

  getOptionDisplayText(): string {
    return this.optionService.getOptionDisplayText(this.b.option, this.i);
  }

  getOptionIcon(option?: any, i?: number): string {
    if (this.shouldShowFeedback() || this.shouldShowCorrectOnTimeout()) {
      return this.b.option.correct ? 'check' : 'close';
    }
    return this.b.optionIcon || '';
  }

  getOptionClasses(): { [key: string]: boolean } {
    const classes = { ...this.b.cssClasses };

    if (this.timerExpired) {
      if (this.shouldShowCorrectOnTimeout()) {
        classes['correct-option'] = true;
      }
      return classes;
    }

    const selections = this.getSelectionsForCurrentBinding();

    // Authoritative check matches OptionUiSyncService logic: id or index
    const effectiveId = (this.b.option.optionId != null && this.b.option.optionId !== -1)
      ? this.b.option.optionId
      : this.i;

    const isActuallySelectedFromService = selections.some(s =>
      (s.optionId != null && effectiveId != null && (s.optionId == effectiveId || String(s.optionId) === String(effectiveId))) ||
      ((s as any).index != null && (s as any).index === this.i) ||
      (s.text && s.text === this.b.option.text)
    );

    const showSelectionState =
      this.b.isSelected ||
      this.b.checked === true ||
      this.b.option?.selected === true ||
      this.b.option?.highlight === true ||
      this.b.highlightCorrect ||
      this.b.highlightIncorrect ||
      isActuallySelectedFromService ||
      this._wasSelected;

    const isCorrect = 
      (this.b.option as any)?.correct === true || 
      String((this.b.option as any)?.correct) === 'true' || 
      (this.b.option as any)?.correct === 1 || 
      (this.b.option as any)?.correct === '1' || 
      this.b.isCorrect === true;

    const hasAnsweredCurrentQuestion = selections.length > 0;
    const shouldRevealCorrectAnswer =
      this.type === 'single' && hasAnsweredCurrentQuestion && isCorrect;

    const feedbackMap = this.b.showFeedbackForOption ?? {};
    const feedbackForThisOption =
      !!feedbackMap[this.optionId] ||
      !!(feedbackMap as any)[String(this.optionId)] ||
      !!(feedbackMap as any)[Number(this.optionId)] ||
      !!(this.b.option?.optionId != null && (feedbackMap as any)[String(this.b.option.optionId)]);

    const shouldHighlightThisOption = (this.type === 'single')
      ? (showSelectionState || feedbackForThisOption)
      : (this.b.option?.highlight === true);

    if (shouldHighlightThisOption) {
      if (isCorrect) {
        classes['correct-option'] = true;
      } else {
        classes['incorrect-option'] = true;
      }
    }

    return classes;
  }

  getOptionCursor(): string {
    return this.b.optionCursor || 'default';
  }

  isDisabled(): boolean {
    return !!this.b.disabled;
  }

  shouldShowIcon(option?: any, i?: number): boolean {
    if (this.timerExpired) {
      return this.shouldShowCorrectOnTimeout();
    }

    const showStandard = !!(option?.showIcon ?? this.b.option.showIcon);
    const showFeedback = this.shouldShowFeedback();
    return showStandard || showFeedback;
  }

  shouldShowCorrectOnTimeout(): boolean {
    if (!this.timerExpired) {
      return false;
    }

    const isCorrect =
      this.b.option?.correct === true ||
      String(this.b.option?.correct) === 'true' ||
      this.b.isCorrect === true;

    // When the timer expires, we want to reveal ALL correct answers
    // regardless of whether they were flagged for icons or highlighted before.
    return isCorrect;
  }

  isPreviousSelection(): boolean {
    // Show feedback for ANY option that was selected (correct or incorrect)
    return this._wasSelected;
  }

  getOptionBackgroundColor(): string | null {
    if (this.timerExpired) {
      return this.shouldShowCorrectOnTimeout() ? '#43e756' : null;
    }

    const selections = this.getSelectionsForCurrentBinding();

    const effectiveId = (this.b.option.optionId != null && this.b.option.optionId !== -1)
      ? this.b.option.optionId
      : this.i;

    const isActuallySelectedFromService = selections.some(s =>
      (s.optionId != null && effectiveId != null && (s.optionId == effectiveId || String(s.optionId) === String(effectiveId))) ||
      ((s as any).index != null && (s as any).index === this.i) ||
      (s.text && s.text === this.b.option.text)
    );

    const isActivelySelected =
      this.b.isSelected ||
      this.b.checked === true ||
      this.b.option?.selected === true ||
      this.b.option?.highlight === true ||
      this.b.highlightCorrect ||
      this.b.highlightIncorrect ||
      this._wasSelected ||
      !!this.b.showFeedbackForOption?.[this.optionId] ||
      isActuallySelectedFromService;

    const isCorrect = 
      (this.b.option as any)?.correct === true || 
      String((this.b.option as any)?.correct) === 'true' || 
      (this.b.option as any)?.correct === 1 || 
      (this.b.option as any)?.correct === '1' || 
      this.b.isCorrect === true;

    const hasAnsweredCurrentQuestion = selections.length > 0;
    const shouldRevealCorrectAnswer =
      this.type === 'single' && hasAnsweredCurrentQuestion && isCorrect;

    const feedbackMap = this.b.showFeedbackForOption ?? {};
    const feedbackForThisOption =
      !!feedbackMap[this.optionId] ||
      !!(feedbackMap as any)[String(this.optionId)] ||
      !!(feedbackMap as any)[Number(this.optionId)] ||
      !!(this.b.option?.optionId != null && (feedbackMap as any)[String(this.b.option.optionId)]);

    const shouldHighlightThisOption = (this.type === 'single')
      ? (isActivelySelected || feedbackForThisOption)
      : (this.b.option?.highlight === true);

    // DEBUG HIGHLIGHT TRACE:
    /* if (this.b.isSelected) {
      console.warn(`[OptionItem] getOptionBackgroundColor isActivelySelected: ID ${this.optionId} correct? ${this.b.option.correct} isActivelySelected eval: ${isActivelySelected}`); */
    if (!shouldHighlightThisOption) {
      return null;
    }

    return isCorrect ? '#43e756' : '#ff0000'; // Green if correct, Red if incorrect
  }

  private getSelectionsForCurrentBinding(): any[] {
    const qIndex = this.currentQuestionIndex ?? this.quizService.currentQuestionIndex;
    const direct = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];

    // Prefer direct index selections only if they actually include this binding.
    // This prevents stale index leakage (e.g. Q2 list reused while rendering Q1).
    if (direct.length > 0 && direct.some((sel: any) => this.matchesBindingSelection(sel))) {
      return direct;
    }

    // Fallback: locate the map entry that actually contains this option
    // (by optionId/text) so previously-selected states keep highlighting.
    const entries = Array.from(this.selectedOptionService.selectedOptionsMap?.entries?.() ?? []);
    for (const [, selections] of entries) {
      if (!Array.isArray(selections) || selections.length === 0) continue;
      if (selections.some((sel: any) => this.matchesBindingSelection(sel))) {
        return selections;
      }
    }

    // Last resort: keep old behavior for correctness-reveal logic that only
    // needs to know the current indexed question has selections.
    return direct;
  }

  private matchesBindingSelection(sel: any): boolean {
    const effectiveId = (this.b.option.optionId != null && this.b.option.optionId !== -1)
      ? this.b.option.optionId
      : this.i;

    return (
      (sel?.optionId != null && effectiveId != null &&
        (sel.optionId == effectiveId || String(sel.optionId) === String(effectiveId))) ||
      (sel?.text && this.b?.option?.text && sel.text === this.b.option.text)
    );
  }

  private hasAnsweredCurrentQuestion(selections: any[]): boolean {
    const fromSelectionService = (selections?.length ?? 0) > 0;
    const fromFeedbackMap = Object.values(this.b?.showFeedbackForOption ?? {}).some(Boolean);
    const fromBindingFlags =
      this.b?.showFeedback === true ||
      this.b?.isSelected === true ||
      this.b?.checked === true ||
      this.b?.highlightCorrect === true ||
      this.b?.highlightIncorrect === true ||
      this.b?.option?.selected === true ||
      this.b?.option?.highlight === true ||
      this._wasSelected;
    const fromAllOptions = (this.b?.allOptions ?? []).some(o => o?.selected === true || o?.highlight === true);

    return fromSelectionService || fromFeedbackMap || fromBindingFlags || fromAllOptions;
  }

  shouldShowFeedback(): boolean {
    const isMulti = this.type === 'multiple';
    const fromBindingMap = !!(this.b.showFeedbackForOption && this.b.showFeedbackForOption[this.optionId]);
    const fromHighlight = this.b.highlightCorrect || this.b.highlightIncorrect || this.b.option?.highlight === true;
    const fromLocked = !!(this.b.disabled && this.b.isSelected);
    const isActuallySelectedFromService = this.isSelectedForCurrentQuestion();

    if (isMulti) {
      // For multi-answer, we only show icons/feedback visuals for what's CURRENTLY highlighted
      // (as per the exclusive highlighting rule)
      return (this.b.option?.highlight === true);
    }
    
    return fromBindingMap || fromHighlight || fromLocked || this.isPreviousSelection() || isActuallySelectedFromService;
  }

  onChanged(event: any): void {
    // console.warn(`[OptionItem] onChanged fired! optionId: ${this.optionId}, isSelected: ${this.b.isSelected}`);
    this.optionUI.emit({
      optionId: this.optionId,
      displayIndex: this.i,
      kind: 'change',
      inputType: this.inputType,
      nativeEvent: event
    });
  }

  onInteraction(event: MouseEvent): void {
    this.optionUI.emit({
      optionId: this.optionId,
      displayIndex: this.i,
      kind: 'interaction',
      inputType: this.inputType,
      nativeEvent: event
    });
  }

  onContentClick(event: MouseEvent): void {
    event.stopPropagation();  // prevents double firing with parent (click)
    this.optionUI.emit({
      optionId: this.optionId,
      displayIndex: this.i,
      kind: 'contentClick',
      inputType: this.inputType,
      nativeEvent: event
    });
  }

  private shouldHighlightOption(): boolean {
    return (
      this.b.isSelected ||
      this.b.checked === true ||
      this.b.option?.selected === true ||
      this.b.option?.highlight === true ||
      this.b.highlightCorrect ||
      this.b.highlightIncorrect ||
      this.isSelectedForCurrentQuestion() ||
      this._wasSelected ||
      !!this.b.showFeedbackForOption?.[this.optionId]
    );
  }

  private isSelectedForCurrentQuestion(): boolean {
    /* const qIndex = this.quizService.currentQuestionIndex;
    const selections = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];
    const effectiveId = (this.b.option.optionId != null && this.b.option.optionId !== -1)
      ? this.b.option.optionId
      : this.i;

    return selections.some(s =>
      (s.optionId != null && effectiveId != null && (s.optionId == effectiveId || String(s.optionId) === String(effectiveId))) ||
      ((s as any).index != null && (s as any).index === this.i) ||
      (s.text && s.text === this.b.option.text)
    ); */
    const selections = this.getSelectionsForCurrentBinding();
    return selections.some((s: any) => this.matchesBindingSelection(s));
  }
}