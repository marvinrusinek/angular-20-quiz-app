import {
  ChangeDetectorRef, Directive, ElementRef, EventEmitter, HostBinding,
  HostListener, Input, OnChanges, OnInit, Output, Renderer2, SimpleChanges
} from '@angular/core';

import { Option } from '../shared/models/Option.model';
import { OptionBindings } from '../shared/models/OptionBindings.model';
import { SharedOptionConfig } from '../shared/models/SharedOptionConfig.model';

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
  @Input() allOptions: Option[] = [];  // to access all options directly
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
    private cdRef: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    if (this.optionBinding) {
      this.optionBinding.directiveInstance = this;
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // New Source Of Truth:
    // Highlighting is now driven by SharedOptionConfig
    if (changes['sharedOptionConfig']) {
      // Immediate highlight update (keeps old UX)
      this.updateHighlightFromConfig();
      return;
    }

    // Legacy Fallback (kept for safety/parity)
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
      console.log('[HighlightOptionDirective] ngOnChanges — no relevant changes detected');
    }
  }


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
      try {
        const opt = this.optionBinding?.option;
        if (!opt) return;  // null guard for strict mode

        const host = this.el.nativeElement as HTMLElement;

      // Check the LIVE binding/option state first — these are mutated synchronously
      // during click handlers, BEFORE this setTimeout fires with potentially stale config.
      const bindingSelected = this.optionBinding?.isSelected === true;
      const optionSelected = opt.selected === true || opt.highlight === true;
      const inputSelected = this.isSelected === true;
      const isLiveSelected = bindingSelected || optionSelected || inputSelected;

      // If the option is currently selected (from live state), apply correct/incorrect color
      if (isLiveSelected) {
        opt.showIcon = true;
        return;
      }

      // Not selected — check config for reset
      if (this.sharedOptionConfig?.option) {
        const cfg = this.sharedOptionConfig;
        const cfgSelected = cfg.isOptionSelected || cfg.option.selected === true || cfg.highlight === true;

        if (cfgSelected) {
          const isCorrectHelper = (o: any) => o && (o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1');
          const isCorrect = isCorrectHelper(cfg.option) || isCorrectHelper(opt);
          opt.showIcon = true;
        } else if (cfg.shouldResetBackground) {
          // Only reset to transparent if the option is truly not selected
          opt.showIcon = false;
        } else {
          opt.showIcon = false;
        }
        return;
      }

      // Legacy Path: only used if sharedOptionConfig is not available
      this.renderer.removeClass(host, 'deactivated-option');
      this.renderer.setStyle(host, 'cursor', 'pointer');
      this.setPointerEvents(host, 'auto');

      if (opt.highlight) {
        opt.showIcon = true;
        return;
      }

      // Disabled
      if (!opt.correct && opt.active === false) {
        this.renderer.addClass(host, 'deactivated-option');
        this.renderer.setStyle(host, 'cursor', 'not-allowed');
        this.setPointerEvents(host, 'none');
      }

      opt.showIcon = false;
      } catch (error: unknown) {
        console.error('[HighlightOptionDirective] updateHighlight failed', error);
      }
    }, 0);
  }

  private updateHighlightFromConfig(): void {
    const cfg = this.sharedOptionConfig;
    if (!cfg || !cfg.option) return;

    const host = this.el.nativeElement as HTMLElement;
    const opt = cfg.option;

    // Always reset first
    this.renderer.removeClass(host, 'deactivated-option');
    this.renderer.setStyle(host, 'cursor', 'pointer');
    this.setPointerEvents(host, 'auto');
    opt.showIcon = false;

    // Check shouldResetBackground FIRST, before selection state
    // This ensures new questions always start clean, regardless of stale state
    if (cfg.shouldResetBackground) {
      opt.showIcon = false;
      return;  // exit early - don't apply any stale highlighting
    }

    // Only apply highlighting if not resetting and actually selected
    const isSelectedNow =
      cfg.highlight === true || cfg.isOptionSelected ||
      cfg.option.selected === true ||
      this.isSelected || this.optionBinding?.isSelected === true;

    // Check correctness from multiple sources
    const isCorrectHelper = (o: any) => o && (o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1');
    const isCorrectAnswer = cfg.isAnswerCorrect || isCorrectHelper(cfg.option) || isCorrectHelper(opt);

    if (isSelectedNow) {
      opt.showIcon = true;
    }
  }


  private setPointerEvents(el: HTMLElement, value: string): void {
    this.renderer.setStyle(el, 'pointer-events', value);
  }
}