import { Injectable, signal } from '@angular/core';

/**
 * Single owner of the question heading's HTML content.
 * Services that need to update the H3 heading must call setHtml() —
 * never reach into the DOM via document.querySelector or
 * renderer.setProperty. The CodelabQuizContentComponent subscribes
 * to htmlSig via an effect and is the only writer of the actual DOM.
 */
@Injectable({ providedIn: 'root' })
export class QuestionHeadingService {
  readonly htmlSig = signal<string>('');

  setHtml(html: string): void {
    const safe = html ?? '';
    if (this.htmlSig() === safe) return;
    // TEMP DIAGNOSTIC — identify which writer stamps a FET. Remove after.
    try {
      const isFet = safe.toLowerCase().includes('correct because');
      const plain = safe.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
      console.log('[QT-SET] isFet=' + isFet + ' "' + plain + '"');
      if (isFet) console.log('[QT-SET-STACK]', new Error().stack);
    } catch { /* ignore */ }
    this.htmlSig.set(safe);
  }

  get(): string {
    return this.htmlSig();
  }
}
