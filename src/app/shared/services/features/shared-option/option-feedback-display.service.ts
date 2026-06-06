import { Injectable } from '@angular/core';

import { FeedbackProps } from '../../../models/FeedbackProps.model';
import { OptionBindings } from '../../../models/OptionBindings.model';

import type { SharedOptionComponent } from '../../../../components/question/answer/shared-option-component/shared-option.component';

type Host = SharedOptionComponent;

/**
 * Template-facing feedback-display predicates for SharedOptionComponent
 * (shouldShowFeedbackFor / shouldShowFeedbackAfter / getInlineFeedbackConfig).
 * The component keeps thin delegators because the HTML template calls them.
 *
 * IMPORTANT: this is the click-feedback pipeline. The [FB-SHOW]/[FB-CFG]
 * console.logs are LOAD-BEARING — removing them previously broke multi-answer
 * FET display. Bodies are moved verbatim (`this.` → host-as-any); do not
 * "clean up" the logging.
 */
@Injectable({ providedIn: 'root' })
export class OptionFeedbackDisplayService {
  shouldShowFeedbackFor(host: Host, b: OptionBindings): boolean {
    const h = host as any;
    const id: any = b.option.optionId;
    return (
      id === h.lastFeedbackOptionId &&
      !!h.feedbackConfigs[id]?.showFeedback
    );
  }

  shouldShowFeedbackAfter(host: Host, b: OptionBindings, i: number): boolean {
    const h = host as any;
    const fbIdx = h._feedbackDisplay?.idx;
    const ok = h._feedbackDisplay !== null && fbIdx === i;
    if (ok || (h._feedbackDisplay !== null && i === 0)) {
      // Only log once per render cycle for idx 0 to confirm template re-eval
      console.log('[FB-SHOW]', 'i:', i, 'fbDisplay.idx:', fbIdx, 'returns:', ok);
    }
    if (h._feedbackDisplay !== null && h._feedbackDisplay.idx === i) {
      return true;
    }
    if (h.timerExpiredForQuestion()) {
      const key = h.keyOf(b.option, i);
      return !!h.feedbackConfigs[key]?.showFeedback;
    }
    return false;
  }

  getInlineFeedbackConfig(host: Host, b: OptionBindings, i: number): FeedbackProps | null {
    const h = host as any;
    const cfg = h.bindingService.getInlineFeedbackConfig(host, b, i);
    if (h._feedbackDisplay !== null && h._feedbackDisplay.idx === i) {
      console.log('[FB-CFG]', 'i:', i, 'returned cfg:', !!cfg, 'showFeedback:', cfg?.showFeedback);
    }
    return cfg;
  }
}
