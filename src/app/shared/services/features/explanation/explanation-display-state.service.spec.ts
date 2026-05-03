import { TestBed } from '@angular/core/testing';
import { Injector } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { ExplanationDisplayStateService } from './explanation-display-state.service';
import { ExplanationFormatterService } from './explanation-formatter.service';

describe('ExplanationDisplayStateService', () => {
  let service: ExplanationDisplayStateService;
  let formatterMock: any;

  beforeEach(() => {
    formatterMock = {
      resetFormatterState: jest.fn(),
      resetProcessedQuestionsState: jest.fn(),
      validateAndCorrectFetPrefix: jest.fn((text: string) => text),
      formattedExplanationSubject: new BehaviorSubject<string>(''),
      formattedExplanation$: new BehaviorSubject<string>('').asObservable(),
      formattedExplanations: {},
      fetByIndex: new Map<number, string>(),
      lockedFetIndices: new Set<number>(),
      explanationsUpdatedSig: { set: jest.fn() },
      explanationsInitializedSig: jest.fn().mockReturnValue(false),
    };
    // Wire up formattedExplanation$ from the subject
    formatterMock.formattedExplanation$ = formatterMock.formattedExplanationSubject.asObservable();

    TestBed.configureTestingModule({
      providers: [
        ExplanationDisplayStateService,
        { provide: ExplanationFormatterService, useValue: formatterMock }
      ]
    });

    service = TestBed.inject(ExplanationDisplayStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ── Initial values ──────────────────────────────────────────────────

  it('should have explanationText$ with initial value of empty string', () => {
    expect(service.explanationText$.getValue()).toBe('');
  });

  it('should have isExplanationTextDisplayedSource with initial value of false', () => {
    expect(service.isExplanationTextDisplayedSource.getValue()).toBe(false);
  });

  it('should have shouldDisplayExplanationSig with initial value of false', () => {
    expect(service.shouldDisplayExplanationSig()).toBe(false);
  });

  it('should have latestExplanation initialized to empty string', () => {
    expect(service.latestExplanation).toBe('');
  });

  it('should have currentQuestionExplanation initialized to null', () => {
    expect(service.currentQuestionExplanation).toBeNull();
  });

  // ── Signal defaults ─────────────────────────────────────────────────

  it('should have activeIndexSig default to 0', () => {
    expect(service.activeIndexSig()).toBe(0);
  });

  it('should have questionRenderedSig default to false', () => {
    expect(service.questionRenderedSig()).toBe(false);
  });

  it('should have quietZoneUntilSig default to 0', () => {
    expect(service.quietZoneUntilSig()).toBe(0);
  });

  // ── Getters / accessors ─────────────────────────────────────────────

  it('shouldDisplayExplanationSnapshot should return current value of shouldDisplayExplanationSig', () => {
    expect(service.shouldDisplayExplanationSnapshot).toBe(false);

    service.shouldDisplayExplanationSig.set(true);
    expect(service.shouldDisplayExplanationSnapshot).toBe(true);

    service.shouldDisplayExplanationSig.set(false);
    expect(service.shouldDisplayExplanationSnapshot).toBe(false);
  });

  it('getLatestExplanation should return current latestExplanation value', () => {
    expect(service.getLatestExplanation()).toBe('');

    service.latestExplanation = 'Test explanation';
    expect(service.getLatestExplanation()).toBe('Test explanation');
  });

  // ── setExplanationText ──────────────────────────────────────────────

  it('setExplanationText with force should update latestExplanation', () => {
    service.setExplanationText('Hello world', { force: true, index: 0 });

    expect(service.latestExplanation).toBe('Hello world');
  });

  it('setExplanationText with empty string and force should clear latestExplanation', () => {
    service.setExplanationText('First value', { force: true, index: 0 });
    service.setExplanationText('', { force: true, index: 0 });

    expect(service.latestExplanation).toBe('');
  });

  // ── Lock / unlock explanation ───────────────────────────────────────

  it('lockExplanation should prevent non-forced updates', () => {
    service.lockExplanation();
    expect(service.isExplanationLocked()).toBe(true);

    // Empty text is blocked when locked (without force)
    service.setExplanationText('First', { force: true, index: 0 });
    service.lockExplanation();
    service.setExplanationText('', { context: 'global', index: 0 });
    expect(service.latestExplanation).toBe('First');
  });

  it('unlockExplanation should allow updates again', () => {
    service.lockExplanation();
    service.unlockExplanation();
    expect(service.isExplanationLocked()).toBe(false);
  });

  // ── normalizeContext ────────────────────────────────────────────────

  it('normalizeContext should return "global" for falsy input', () => {
    expect(service.normalizeContext(undefined)).toBe('global');
    expect(service.normalizeContext(null)).toBe('global');
    expect(service.normalizeContext('')).toBe('global');
  });

  it('normalizeContext should trim and return non-empty input', () => {
    expect(service.normalizeContext('  test  ')).toBe('test');
    expect(service.normalizeContext('myContext')).toBe('myContext');
  });

  // ── resetExplanationText ────────────────────────────────────────────

  it('resetExplanationText should clear all explanation state', () => {
    service.setExplanationText('Some explanation', { force: true, index: 0 });
    service.shouldDisplayExplanationSig.set(true);
    service.isExplanationTextDisplayedSource.next(true);

    service.resetExplanationText();

    expect(service.latestExplanation).toBe('');
    expect(service.shouldDisplayExplanationSig()).toBe(false);
    expect(service.isExplanationTextDisplayedSource.getValue()).toBe(false);
  });

  // ── setCurrentQuestionExplanation ───────────────────────────────────

  it('setCurrentQuestionExplanation should store the value', () => {
    service.setCurrentQuestionExplanation('My explanation');
    expect(service.currentQuestionExplanation).toBe('My explanation');
  });

  // ── _activeIndex getter/setter ──────────────────────────────────────

  it('setting _activeIndex should update activeIndexSig', () => {
    service._activeIndex = 5;
    expect(service.activeIndexSig()).toBe(5);
    expect(service._activeIndex).toBe(5);
  });

  it('setting _activeIndex to null should not update activeIndexSig', () => {
    service._activeIndex = 3;
    expect(service.activeIndexSig()).toBe(3);

    service._activeIndex = null;
    expect(service._activeIndex).toBeNull();
    // Signal stays at last non-null value
    expect(service.activeIndexSig()).toBe(3);
  });

  // ── getOrCreate ─────────────────────────────────────────────────────

  it('getOrCreate should return text$ and gate$ subjects for an index', () => {
    const result = service.getOrCreate(0);
    expect(result.text$).toBeDefined();
    expect(result.gate$).toBeDefined();
  });

  it('getOrCreate should reuse existing subjects for the same index', () => {
    const first = service.getOrCreate(2);
    const second = service.getOrCreate(2);
    expect(first.gate$).toBe(second.gate$);
  });

  // ── setGate ─────────────────────────────────────────────────────────

  it('setGate should create and update gate subjects', () => {
    service.setGate(1, true);
    const gate = service._gate.get(1);
    expect(gate).toBeDefined();
    expect(gate!.getValue()).toBe(true);

    service.setGate(1, false);
    expect(gate!.getValue()).toBe(false);
  });
});
