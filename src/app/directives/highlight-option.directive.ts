import { ChangeDetectorRef, Directive, ElementRef, EventEmitter, HostBinding,
  HostListener, Input, OnChanges, OnInit, Output, Renderer2, SimpleChanges
} from '@angular/core';

import { Option } from '../shared/models/Option.model';
import { OptionBindings } from '../shared/models/OptionBindings.model';
import { SharedOptionConfig } from '../shared/models/SharedOptionConfig.model';
import { UserPreferenceService } from '../shared/services/user-preference.service';

@Directive({
  selector: '[appHighlightOption]',
  exportAs: 'appHighlightOption',
  standalone: true,
})
export class HighlightOptionDirective implements OnInit, OnChanges {
  @Output() resetBackground = new EventEmitter<boolean>();
  @Output() optionClicked = new EventEmitter<Option>();
  @Input() appHighlightInputType: 'checkbox' | 'radio' = 'radio';
  @Input() type: 'single' | 'multiple' = 'single';
  @Input() appHighlightReset = false;
  @Input() appResetBackground = false;
  @Input() option!: Option;
  @Input() showFeedbackForOption: { [key: number]: boolean } = {};
  @Input() highlightCorrectAfterIncorrect = false;
  @Input() allOptions: Option[] = []; // to access all options directly
  @Input() optionsToDisplay: Option[] = [];
  @Input() optionBinding: OptionBindings | undefined;
  @Input() selectedOptionHistory: number[] = [];
  @Input() isSelected = false;
  @Input() isCorrect = false;
  @Input() isAnswered = false;
  @Input() showFeedback = false;
  @Input() renderReady = false;
  @Input() sharedOptionConfig!: SharedOptionConfig;

  constructor(
    private el: ElementRef,
    private renderer: Renderer2,
    private cdRef: ChangeDetectorRef,
    private userPreferenceService: UserPreferenceService
  ) {}

  ngOnInit(): void {
    if (this.optionBinding) {
      this.optionBinding.directiveInstance = this;
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // NEW SOURCE OF TRUTH:
    // Highlighting is now driven by SharedOptionConfig
    if (changes['sharedOptionConfig']) {
      // Immediate highlight update (keeps old UX)
      this.updateHighlightFromConfig();
      return;
    }

    // LEGACY FALLBACK (kept for safety / parity)
    // These inputs may still fire during transition
    const optionBindingChanged = changes['optionBinding'] || changes['option'];
    const isSelectedChanged = changes['isSelected'];
    const showFeedbackChanged = changes['showFeedback'];
    const resetChanged = changes['appHighlightReset'];

    const highlightRelevant =
      optionBindingChanged || isSelectedChanged || showFeedbackChanged ||
      resetChanged;

    // If something worth reacting to changed, run the full logic
    if (highlightRelevant && this.optionBinding) {
      // Maintain reference back to this directive
      this.optionBinding.directiveInstance = this;

      // Immediate highlight update (keeps old UX)
      this.updateHighlight();
    } else {
      console.log('[🛑 HighlightOptionDirective] ngOnChanges — no relevant changes detected');
    }
  }

  @HostBinding('style.background-color')
  backgroundColor: string = '';

  @HostListener('click')
  onClick(): void {
    try {
      // Check if the option is deactivated (highlighted or inactive)
      if (this.option?.highlight || this.option?.active === false) {
        console.info('Deactivated option clicked. No action taken:', this.option);
        return;
      }

      // Emit the event and update visuals
      if (this.option) {
        this.optionClicked.emit(this.option);  // notify parent
        this.updateHighlight();  // update UI
        this.cdRef.detectChanges();  // ensure re-render
      }
    } catch (error: any) {
      console.error('Error in onClick:', error);
    }
  }

  updateHighlight(): void {
    if (!this.optionBinding?.option) return;

    setTimeout(() => {
      const opt = this.optionBinding?.option;
      if (!opt) return;  // null guard for strict mode

      const host = this.el.nativeElement as HTMLElement;

      // Reset styles
      this.renderer.removeStyle(host, 'background-color');
      this.renderer.removeClass(host, 'deactivated-option');
      this.renderer.setStyle(host, 'cursor', 'pointer');
      this.setPointerEvents(host, 'auto');

      // Selected
      if (opt.highlight) {
        this.setBackgroundColor(host, opt.correct ? '#43f756' : '#ff0000');
        opt.showIcon = true;  // keep ✓/✗
        return;
      }

      // Disabled
      if (!opt.correct && opt.active === false) {
        this.setBackgroundColor(host, '#a3a3a3');
        this.renderer.addClass(host, 'deactivated-option');
        this.renderer.setStyle(host, 'cursor', 'not-allowed');
        this.setPointerEvents(host, 'none');
      }

      opt.showIcon = false;  // fallback: no highlight and not disabled — no icon
    }, 0);
  }

  private updateHighlightFromConfig(): void {
    const cfg = this.sharedOptionConfig;
    if (!cfg || !cfg.option) return;

    const host = this.el.nativeElement as HTMLElement;
    const opt = cfg.option;

    // Reset
    this.renderer.removeStyle(host, 'background-color');
    this.renderer.removeClass(host, 'deactivated-option');
    this.renderer.setStyle(host, 'cursor', 'pointer');
    this.setPointerEvents(host, 'auto');
    opt.showIcon = false;

    // Selected (robust against Angular timing) - check all possible selection indicators
    const isSelectedNow =
      cfg.highlight === true || cfg.isOptionSelected ||
      cfg.option.selected === true;

    if (isSelectedNow) {
      this.setBackgroundColor(host, cfg.isAnswerCorrect ? '#43f756' : '#ff0000');
      opt.showIcon = true;
      return;
    }

    // Reset between questions
    if (cfg.shouldResetBackground) {
      this.setBackgroundColor(host, 'transparent');
      opt.showIcon = false;
    }
  }

  private setBackgroundColor(element: HTMLElement, color: string): void {
    this.renderer.setStyle(element, 'background-color', color);
  }

  private setPointerEvents(el: HTMLElement, value: string): void {
    this.renderer.setStyle(el, 'pointer-events', value);
  }
}