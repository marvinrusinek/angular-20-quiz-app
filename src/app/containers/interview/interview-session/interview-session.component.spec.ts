import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { Quiz } from '../../../shared/models/Quiz.model';
import { Option } from '../../../shared/models/Option.model';
import { setQuizDataCache } from '../../../shared/quiz-data-cache';
import { ArrayUtils } from '../../../shared/utils/array-utils';

import { InterviewSessionService } from '../../../shared/services/features/interview/interview-session.service';

import { InterviewSessionComponent } from './interview-session.component';

function makeCatalog(): Quiz[] {
  const q = (n: number) => ({
    questionText: `Question number ${n}?`,
    options: [{ text: `q${n}-A`, correct: true }, { text: `q${n}-B` }] as Option[],
    explanation: `e${n}`
  });
  return [{
    quizId: 'ts', milestone: 'TS', summary: '', image: '', difficulty: 'beginner',
    questions: Array.from({ length: 10 }, (_, i) => q(i + 1))
  }];
}

describe('InterviewSessionComponent', () => {
  let fixture: ComponentFixture<InterviewSessionComponent>;
  let component: InterviewSessionComponent;
  let session: InterviewSessionService;

  const questionBox = () =>
    fixture.nativeElement.querySelector('mat-card.quiz-card') as HTMLElement;
  const questionHeading = () =>
    fixture.nativeElement.querySelector('mat-card.quiz-card .interview-question') as HTMLElement;
  const optionRows = () =>
    Array.from(fixture.nativeElement.querySelectorAll('.io-option')) as HTMLElement[];
  const optionInputs = () =>
    Array.from(fixture.nativeElement.querySelectorAll('.io-input')) as HTMLInputElement[];
  const optionTexts = () => optionRows().map((r) => r.textContent!.trim());

  beforeEach(async () => {
    jest.spyOn(ArrayUtils, 'shuffleArray').mockImplementation((a) => a);
    setQuizDataCache(makeCatalog(), []);

    await TestBed.configureTestingModule({
      imports: [InterviewSessionComponent],
      providers: [{ provide: Router, useValue: { navigate: jest.fn() } }]
    }).compileComponents();

    session = TestBed.inject(InterviewSessionService);
    session.start({ difficulty: 'mixed', topicIds: ['ts'], questionCount: 10 });

    fixture = TestBed.createComponent(InterviewSessionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setQuizDataCache([], []);
  });

  it('renders a generated question questionText inside the regular question box', () => {
    expect(questionBox()).toBeTruthy();
    expect(questionHeading()).toBeTruthy();
    expect(questionHeading().textContent!.trim()).toBe('Question number 1?');
  });

  it('renders the current question options (clickable radio/checkbox)', () => {
    expect(optionTexts()).toEqual(['q1-A', 'q1-B']);
    expect(optionInputs().length).toBe(2);
  });

  it('records a selection and increments the answered counter', () => {
    expect(component.answeredIndices().size).toBe(0);
    optionInputs()[0].click();
    fixture.detectChanges();
    expect(session.isAnswered(0)).toBe(true);
    expect(component.answeredIndices().size).toBe(1);
  });

  it('refreshes the question text and options on navigation', () => {
    expect(questionHeading().textContent!.trim()).toBe('Question number 1?');
    expect(optionTexts()).toEqual(['q1-A', 'q1-B']);

    component.onNavigate(2);
    fixture.detectChanges();

    expect(questionHeading().textContent!.trim()).toBe('Question number 3?');
    expect(optionTexts()).toEqual(['q3-A', 'q3-B']);
  });

  it('restores a saved selection when returning to a question', () => {
    optionInputs()[1].click();
    fixture.detectChanges();
    component.onNavigate(1);
    fixture.detectChanges();
    expect(optionInputs().some((i) => i.checked)).toBe(false);
    component.onNavigate(0);
    fixture.detectChanges();
    expect(optionInputs()[1].checked).toBe(true);
  });

  it('never exposes correctness classes on the options', () => {
    optionInputs()[0].click();
    fixture.detectChanges();
    for (const row of optionRows()) {
      expect(row.className).not.toMatch(/correct|incorrect|wrong|right/i);
    }
  });

  it('renders the pagination after the question box', () => {
    const card = questionBox();
    const paginator = fixture.nativeElement.querySelector('app-interview-paginator') as HTMLElement;
    expect(card.compareDocumentPosition(paginator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
