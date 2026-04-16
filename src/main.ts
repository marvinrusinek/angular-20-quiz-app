import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';

import { routes } from './app/router/quiz-routing.routes';
import { AppComponent } from './app/app.component';
import { QUIZ_DATA } from './app/shared/quiz';

// ══════════════════════════════════════════════════════════════════════
// GLOBAL FET WATCHDOG. Installed before Angular bootstrap. Watches the
// entire document for any element that displays FET-like text. When it
// finds such text, it consults the bundled QUIZ_DATA (immune to any
// runtime mutation) and the current live selection state (scraped from
// the DOM itself — CSS classes on option rows). If any pristine-correct
// option isn't currently selected on screen, the offending element's
// innerHTML is reverted to the plain question text.
// ══════════════════════════════════════════════════════════════════════
(function installGlobalFetWatchdog() {
  try {
    const nrm = (t: any) => String(t ?? '').trim().toLowerCase();
    const findPristineForText = (qText: string): { correctTexts: string[]; raw: string; explanation: string } | null => {
      const k = nrm(qText);
      if (!k) return null;
      for (const quiz of (QUIZ_DATA as any[]) ?? []) {
        for (const pq of quiz?.questions ?? []) {
          if (nrm(pq?.questionText) !== k) continue;
          const correctTexts = ((pq?.options ?? []) as any[])
            .filter((o: any) => o?.correct === true || String(o?.correct) === 'true')
            .map((o: any) => nrm(o?.text))
            .filter((t: string) => !!t);
          return {
            correctTexts,
            raw: pq?.questionText ?? '',
            explanation: nrm(pq?.explanation ?? '')
          };
        }
      }
      return null;
    };
    const isFetLike = (text: string, explanation?: string): boolean => {
      const n = nrm(text);
      if (!n) return false;
      if (n.includes('are correct because')) return true;
      if (n.includes('is correct because')) return true;
      if (n.includes('correct because')) return true;
      if (explanation && explanation.length > 10 && n.includes(explanation)) return true;
      return false;
    };
    const scrapeSelectedOptionTexts = (): Set<string> => {
      const out = new Set<string>();
      const selectors = [
        'codelab-option-item',
        '.option-row',
        '.option-item',
        'li[role="option"]',
        '.mat-mdc-list-option'
      ];
      for (const sel of selectors) {
        const rows = document.querySelectorAll(sel);
        rows.forEach((row: any) => {
          const cls = String(row?.className ?? '');
          const looksSelected = cls.includes('selected')
            || cls.includes('highlight')
            || cls.includes('active')
            || row?.querySelector?.('.selected, .highlight, .active, mat-icon.correct-icon, .correct-icon') != null;
          if (!looksSelected) return;
          const txt = nrm(row?.textContent ?? '');
          if (txt) out.add(txt);
        });
      }
      return out;
    };
    const findQuestionTextFromPristine = (): { qText: string; correctTexts: string[]; explanation: string } | null => {
      // Scan the page for any pristine question text that currently
      // appears in the DOM. This tells us which question is displayed.
      const bodyText = nrm(document.body?.textContent ?? '');
      if (!bodyText) return null;
      for (const quiz of (QUIZ_DATA as any[]) ?? []) {
        for (const pq of quiz?.questions ?? []) {
          const qt = nrm(pq?.questionText ?? '');
          if (!qt) continue;
          if (!bodyText.includes(qt)) continue;
          const correctTexts = ((pq?.options ?? []) as any[])
            .filter((o: any) => o?.correct === true || String(o?.correct) === 'true')
            .map((o: any) => nrm(o?.text))
            .filter((t: string) => !!t);
          return { qText: pq?.questionText ?? '', correctTexts, explanation: nrm(pq?.explanation ?? '') };
        }
      }
      return null;
    };
    const enforce = () => {
      try {
        // DIAGNOSTIC: scan body for any FET-like text and log it.
        const bodyHtml = document.body?.innerHTML ?? '';
        const fetMatches = bodyHtml.match(/[A-Z][^<>]{0,200}(are correct because|is correct because)[^<>]{0,300}/gi);
        if (fetMatches && fetMatches.length > 0) {
          // eslint-disable-next-line no-console
          console.warn('[GLOBAL FET-WATCHDOG] 🔍 FET-like text detected in DOM:', fetMatches.slice(0, 3));
        }
        const current = findQuestionTextFromPristine();
        if (!current) {
          if (fetMatches && fetMatches.length > 0) {
            // eslint-disable-next-line no-console
            console.warn('[GLOBAL FET-WATCHDOG] ⚠ FET present but findQuestionTextFromPristine returned null');
          }
          return;
        }
        if (current.correctTexts.length < 2) return;  // not multi-answer
        const selectedTexts = scrapeSelectedOptionTexts();
        const allSel = current.correctTexts.every(t => {
          for (const sel of selectedTexts) {
            if (sel.includes(t)) return true;
          }
          return false;
        });
        if (allSel) return;
        // eslint-disable-next-line no-console
        console.warn(`[GLOBAL FET-WATCHDOG] 🎯 enforcing — pristine correct=${JSON.stringify(current.correctTexts)} selected=${JSON.stringify([...selectedTexts])}`);
        // Find ANY DOM node whose text looks like FET and revert it.
        const all = document.querySelectorAll('*');
        let revertCount = 0;
        let candidateCount = 0;
        all.forEach((h: any) => {
          try {
            const tc = h?.textContent ?? '';
            const html = h?.innerHTML ?? '';
            if (!isFetLike(tc, current.explanation) && !isFetLike(html, current.explanation)) return;
            candidateCount++;
            const childCount = h?.children?.length ?? 0;
            // eslint-disable-next-line no-console
            console.warn(`[GLOBAL FET-WATCHDOG] candidate <${h.tagName}.${h.className}> children=${childCount} tc="${tc.slice(0, 120)}"`);
            // Revert only leaf-ish nodes — avoid stomping huge ancestors.
            if (childCount > 3) return;
            h.innerHTML = current.qText;
            revertCount++;
            // eslint-disable-next-line no-console
            console.warn(`[GLOBAL FET-WATCHDOG] ⛔ reverted <${h.tagName}.${h.className}>`);
          } catch { /* ignore */ }
        });
        // eslint-disable-next-line no-console
        console.warn(`[GLOBAL FET-WATCHDOG] revert pass complete — candidates=${candidateCount} reverted=${revertCount}`);
      } catch { /* ignore */ }
    };
    const mo = new MutationObserver(() => enforce());
    const start = () => {
      try {
        mo.observe(document.body, { childList: true, characterData: true, subtree: true });
        // eslint-disable-next-line no-console
        console.warn('%c[GLOBAL FET-WATCHDOG] INSTALLED', 'background:#060;color:#fff;padding:2px 6px;');
      } catch { /* ignore */ }
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
    document.addEventListener('click', () => setTimeout(enforce, 50), true);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[GLOBAL FET-WATCHDOG] install failed', e);
  }
})();

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withFetch()),
    provideRouter(routes),
    provideAnimations(),
  ],
}).catch((err) => console.error(err));
