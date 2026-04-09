import {
  Directive, effect, ElementRef, HostListener, input, OnInit, output, Renderer2
} from '@angular/core';

import { Option } from '../shared/models/Option.model';
import { OptionBindings } from '../shared/models/OptionBindings.model';
import { SharedOptionConfig } from '../shared/models/SharedOptionConfig.model';

@Directive({
  selector: '[appHighlightOption]',
  exportAs: 'appHighlightOption',
  standalone: true
})
export class HighlightOptionDirective implements OnInit {
  readonly resetBackground = output<boolean>();
  readonly optionClicked = output<Option>();
  readonly appHighlightInputTypeInput =
    input<'checkbox' | 'radio'>('radio',
      { alias: 'appHighlightInputType' });
  appHighlightInputType: 'checkbox' | 'radio' = 'radio';
  readonly type =
    input<'single' | 'multiple'>('single');
  readonly appHighlightResetInput =
    input(false, { alias: 'appHighlightReset' });
  appHighlightReset = false;
  readonly appResetBackground = input(false);
  readonly optionInput =
    input<Option | undefined>(undefined, { alias: 'option' });
  option!: Option;
  readonly showFeedbackForOption =
    input<{ [key: number]: boolean; }>({});
  readonly highlightCorrectAfterIncorrect =
    input(false);
  readonly allOptions = input<Option[]>([]);
  readonly optionsToDisplay = input<Option[]>([]);
  readonly optionBinding =
    input<OptionBindings>();
  readonly selectedOptionHistory = input<number[]>([]);
  readonly isSelectedInput =
    input(false, { alias: 'isSelected' });
  isSelected = false;
  readonly isCorrect = input(false);
  readonly isAnswered = input(false);
  readonly showFeedback = input(false);
  readonly renderReady = input(false);
  readonly sharedOptionConfig =
    input.required<SharedOptionConfig>();

  constructor(
    private el: ElementRef,
    private renderer: Renderer2
  ) {
    // Mirror the signal input to the mutable backing field so legacy
    // code paths (syncDerivedInputs, updateHighlight) can read/write it.
    effect(() => {
      this.isSelected = this.isSelectedInput();
    });

    effect(() => {
      const t = this.appHighlightInputTypeInput();
      if (t) this.appHighlightInputType = t;
    });

    effect(() => {
      this.appHighlightReset = this.appHighlightResetInput();
    });

    effect(() => {
      const o = this.optionInput();
      if (o) this.option = o;
    });

    // sharedOptionConfig is the source of truth for highlighting.
    effect(() => {
      const cfg = this.sharedOptionConfig();
      if (!cfg) return;
      this.syncDerivedInputs();
      this.updateHighlightFromConfig();
    });

    // Legacy fallback path: react to optionBinding changes.
    effect(() => {
      const binding = this.optionBinding();
      if (!binding) return;
      this.syncDerivedInputs();
      binding.directiveInstance = this;
      this.updateHighlight();
    });
  }

  ngOnInit(): void {
    const optionBinding = this.optionBinding();
    if (optionBinding) {
      optionBinding.directiveInstance = this;
    }
  }

  /** Derive individual inputs from sharedOptionConfig / optionBinding when not explicitly set. */
  private syncDerivedInputs(): void {
    const sharedOptionConfig = this.sharedOptionConfig();
    if (sharedOptionConfig) {
      this.appHighlightInputType = sharedOptionConfig.type === 'multiple' ? 'checkbox' : 'radio';
      this.appHighlightReset = sharedOptionConfig.shouldResetBackground;
    }
    const optionBinding = this.optionBinding();
    if (optionBinding) {
      this.option = optionBinding.option;
      this.isSelected = optionBinding.isSelected;
    }
  }

  @HostListener('click')
  onClick(): void {
    // NO-OP: Click handling is done by OptionItemComponent (onContentClick / onChanged).
    // Running updateHighlight() here fires BEFORE the click handler processes,
    // which reads stale binding state and can reset showIcon to false,
    // preventing the first click from highlighting.
  }

  updateHighlight(): void {
    if (!this.optionBinding()?.option) return;

    setTimeout(() => {
      try {
        const optionBinding = this.optionBinding();
        const opt = optionBinding?.option;
        if (!opt) return;  // null guard for strict mode

        const host = this.el.nativeElement as HTMLElement;

        // Check the LIVE binding/option state first — these are mutated synchronously
        // during click handlers, BEFORE this setTimeout fires with potentially stale config.
        const bindingSelected = optionBinding?.isSelected === true;
        const optionSelected = opt.selected === true || opt.highlight === true;
        const inputSelected = this.isSelected;
        const isLiveSelected = bindingSelected || optionSelected || inputSelected;

        // If the option is currently selected (from live state), apply correct/incorrect color
        if (isLiveSelected) {
          opt.showIcon = true;
          return;
        }

        // Not selected — check config for reset
        const sharedOptionConfig = this.sharedOptionConfig();
        if (sharedOptionConfig?.option) {
          const cfg = sharedOptionConfig;
          const cfgSelected =
            cfg.isOptionSelected || cfg.option.selected === true || cfg.highlight === true;

          if (cfgSelected) {
            const isCorrectHelper =
              (o: any) =>
              o && (o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1');
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
          this.renderer.setStyle(host, 'cursor', 'default');
          this.setPointerEvents(host, 'none');
        }

        opt.showIcon = false;
      } catch (error: unknown) {
        console.error('[HighlightOptionDirective] updateHighlight failed', error);
      }
    }, 0);
  }

  private updateHighlightFromConfig(): void {
    const cfg = this.sharedOptionConfig();
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
      this.isSelected || this.optionBinding()?.isSelected === true;

    if (isSelectedNow) {
      opt.showIcon = true;
    }
  }

  private setPointerEvents(el: HTMLElement, value: string): void {
    this.renderer.setStyle(el, 'pointer-events', value);
  }
}