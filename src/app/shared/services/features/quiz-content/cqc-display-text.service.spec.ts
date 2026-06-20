/**
 * Regression coverage for the multi-answer FET-display rule fixed this session
 * (2026-06-20): the cached-FET "bypass" that lets the all-correct explanation
 * render must require EVERY correct option to be selected for a multi-answer
 * question — otherwise the FET flashed on the first correct click. Single-answer
 * is unchanged (its one correct option is "all correct"). The durable
 * bypass/perfect flags remain an independent authoritative path.
 *
 * Targets the pure predicate `computeFetBypass` (and its helper
 * `allCorrectOptionsSelected`) via a host stub — no DOM/component needed.
 */
import { TestBed } from '@angular/core/testing';

import { CqcDisplayTextService } from './cqc-display-text.service';
import { CqcFetGuardService } from './cqc-fet-guard.service';

const FET = 'Options 1 and 3 are correct because reasons.';

function makeHost(opts: {
  selected: Array<{ text: string; correct: boolean; selected?: boolean }>;
  pristineCorrect: string[];           // already-normalized correct texts
  bypassFlag?: boolean;
  perfectFlag?: boolean;
  cachedFet?: string;
}): any {
  const idx = 0;
  return {
    selectedOptionService: {
      getSelectedOptionsForQuestion: (_i: number) => opts.selected
    },
    quizService: {
      getDisplayedQuestion: (_i: number) => ({ questionText: 'Q', options: [] }),
      questions: [{ questionText: 'Q', options: [] }],
      getPristineCorrectTextsForQuestion: (_t: string) => new Set(opts.pristineCorrect),
      _multiAnswerPerfect: new Map<number, boolean>(opts.perfectFlag ? [[idx, true]] : [])
    },
    explanationTextService: {
      formattedExplanations: opts.cachedFet ? { [idx]: { explanation: opts.cachedFet } } : {},
      fetByIndex: new Map<number, string>(),
      fetBypassForQuestion: new Map<number, boolean>(opts.bypassFlag ? [[idx, true]] : [])
    }
  };
}

describe('CqcDisplayTextService.computeFetBypass — FET only when all correct (multi-answer)', () => {
  let service: CqcDisplayTextService;
  const callBypass = (host: any, text: string) =>
    (service as any).computeFetBypass(host, 0, text, -1) as boolean;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CqcDisplayTextService,
        { provide: CqcFetGuardService, useValue: {} }
      ]
    });
    service = TestBed.inject(CqcDisplayTextService);
  });

  it('multi-answer: cached FET + only ONE of two correct selected → NO bypass', () => {
    const host = makeHost({
      selected: [{ text: 'Alpha', correct: true, selected: true }],
      pristineCorrect: ['alpha', 'charlie'],
      cachedFet: FET
    });
    expect(callBypass(host, FET)).toBe(false);
  });

  it('multi-answer: cached FET + BOTH correct selected → bypass', () => {
    const host = makeHost({
      selected: [
        { text: 'Alpha', correct: true, selected: true },
        { text: 'Charlie', correct: true, selected: true }
      ],
      pristineCorrect: ['alpha', 'charlie'],
      cachedFet: FET
    });
    expect(callBypass(host, FET)).toBe(true);
  });

  it('multi-answer: durable perfect flag bypasses regardless of selection', () => {
    const host = makeHost({
      selected: [{ text: 'Alpha', correct: true, selected: true }],
      pristineCorrect: ['alpha', 'charlie'],
      cachedFet: FET,
      perfectFlag: true
    });
    expect(callBypass(host, FET)).toBe(true);
  });

  it('multi-answer: durable fetBypass flag bypasses regardless of selection', () => {
    const host = makeHost({
      selected: [{ text: 'Alpha', correct: true, selected: true }],
      pristineCorrect: ['alpha', 'charlie'],
      cachedFet: FET,
      bypassFlag: true
    });
    expect(callBypass(host, FET)).toBe(true);
  });

  it('single-answer: cached FET + the one correct selected → bypass', () => {
    const host = makeHost({
      selected: [{ text: 'Right', correct: true, selected: true }],
      pristineCorrect: ['right'],            // single correct
      cachedFet: 'Option 1 is correct because reasons.'
    });
    expect(callBypass(host, 'Option 1 is correct because reasons.')).toBe(true);
  });

  it('no cached-FET match and no flags → NO bypass', () => {
    const host = makeHost({
      selected: [
        { text: 'Alpha', correct: true, selected: true },
        { text: 'Charlie', correct: true, selected: true }
      ],
      pristineCorrect: ['alpha', 'charlie'],
      cachedFet: FET
    });
    // Incoming text does not match the cached FET → fallback can't fire.
    expect(callBypass(host, 'some unrelated heading text')).toBe(false);
  });
});
