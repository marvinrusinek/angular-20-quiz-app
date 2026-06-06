import { Injectable, effect } from '@angular/core';

import { Option } from '../../../models/Option.model';

import type { SharedOptionComponent } from '../../../../components/question/answer/shared-option-component/shared-option.component';
import { norm } from '../../../utils/text-norm';

type Host = SharedOptionComponent;

/**
 * Owns the SharedOptionComponent's UI-sync constructor effects: the signal
 * input → backing-field mirrors plus the render-sync watchdogs (auto-show
 * options, self-heal binding generation). These are split across two register
 * methods so the host can preserve the EXACT original effect-creation order
 * around the interaction (Q→Q cleanup) effect that sits between them — creation
 * order is load-bearing because effects flush in creation order when several
 * inputs change in the same tick.
 *
 * Each effect must be created in the host's injection context, so these methods
 * are called synchronously from the component constructor (which IS an
 * injection context); they close over `host` to reach its signals/fields.
 */
@Injectable({ providedIn: 'root' })
export class OptionUiSyncEffectsService {
  /**
   * Effect #1 (original position): mirror the currentQuestion signal input into
   * the mutable backing field. Registered before the interaction cleanup effect.
   */
  registerCurrentQuestionMirror(host: Host): void {
    effect(() => {
      const v = host.currentQuestionInput();
      if (v !== undefined) host.currentQuestion.set(v);
    });
  }

  /**
   * Effects #3–#9 (original positions): the remaining input mirrors
   * (optionsToDisplay + shuffle guard, type, optionBindings + auto-reveal
   * guard, isNavigatingBackwards, renderReady) and the render-sync watchdogs
   * (auto-show options, self-heal binding generation). Registered immediately
   * after the interaction cleanup effect to preserve original order.
   */
  registerInputAndRenderSync(host: Host): void {
    effect(() => {
      let v = host.optionsToDisplayInput();
      if (v !== undefined) {
        // SHUFFLE GUARD: ensure options belong to the shuffled question for this index.
        // Compare the SET of option texts — if the incoming options have texts that
        // don't match the shuffled question's options, replace them.
        const qs = host.quizService;
        if (qs.isShuffleEnabled() && qs.shuffledQuestions?.length > 0) {
          const idx = host.currentQuestionIndex ?? qs.currentQuestionIndex ?? 0;
          const correctQ = qs.shuffledQuestions[idx];
          if (correctQ?.options?.length > 0 && v.length > 0) {
            const correctTexts = new Set(correctQ.options.map((o: Option) => norm(o?.text)));
            const actualTexts = new Set(v.map((o: Option) => norm(o?.text)));
            const match = correctTexts.size === actualTexts.size && [...correctTexts].every(t => actualTexts.has(t));
            if (!match) {
              v = correctQ.options.map((o: Option) => ({ ...o }));
            }
          }
        }
        host.optionsToDisplay = v;
      }
    });
    effect(() => {
      const v = host.typeInput();
      if (v !== undefined) host.type = v;
    });
    effect(() => {
      const v = host.optionBindingsInput();
      if (v !== undefined) {
        // Don't let a stale parent push overwrite auto-reveal bindings.
        // The parent's optionBindings() doesn't carry _autoRevealedCorrect,
        // so a zone.js tick re-evaluating the parent template would wipe
        // the green highlight set by triggerAllIncorrectsExhaustedAutoReveal.
        if (host.optionBindings().some((b) => b?._autoRevealedCorrect)) return;
        host.optionBindings.set(v);
      }
    });
    // Auto-show options when bindings are populated. Without this, paths
    // that populate optionBindings without explicitly calling
    // showOptions.set(true) (e.g. dynamic component creation) leave the
    // template gated and options never render.
    effect(() => {
      if (host.optionBindings().length > 0) host.showOptions.set(true);
    });
    // SELF-HEAL WATCHDOG: when optionsToDisplay has items but optionBindings is
    // empty, the binding generation race lost — options never render. This
    // watchdog forces generation. Runs only when the mismatch persists (no
    // infinite loop because once bindings exist the condition stops firing).
    effect(() => {
      const opts = host.optionsToDisplay;
      const bindings = host.optionBindings();
      if (Array.isArray(opts) && opts.length > 0 && (!bindings || bindings.length === 0)) {
        // Reset the early-return guard in generateOptionBindings
        host.optionBindingsInitialized.set(false);
        // Defer one microtask so we don't recurse inside the current effect
        queueMicrotask(() => {
          try {
            host.generateOptionBindings();
          } catch (e) {
            console.error('SharedOptionComponent self-heal generateOptionBindings failed', e);
          }
        });
      }
    });
    effect(() => {
      host.isNavigatingBackwards.set(host.isNavigatingBackwardsInput());
    });
    effect(() => {
      host.renderReady.set(host.renderReadyInput());
    });
  }
}
