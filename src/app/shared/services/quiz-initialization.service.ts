// SETS UP QUIZ, LOADS QUESTIONS
import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import { Option } from '../models/Option.model';
import { Quiz } from '../models/Quiz.model';
import { QuizQuestion } from '../models/QuizQuestion.model';
import { NextButtonStateService } from './next-button-state.service';
import { QuizService } from './quiz.service';
import { QuizStateService } from './quizstate.service';
import { SelectedOptionService } from './selectedoption.service';
import { SelectionMessageService } from './selection-message.service';

@Injectable({ providedIn: 'root' })
export class QuizInitializationService {
  data: QuizQuestion | null = null;
  selectedQuiz: Quiz = {} as Quiz;
  question: QuizQuestion | null = null;
  questions: QuizQuestion[] = [];
  questionIndex = 0;
  currentQuestion: QuizQuestion | null = null;
  currentQuestionIndex = 0;
  totalQuestions = 0;
  numberOfCorrectAnswers = 0;
  quizId = '';
  selectedOption$: BehaviorSubject<Option | null> =
    new BehaviorSubject<Option | null>(null);

  options: Option[] = [];
  optionsToDisplay: Option[] = [];
  optionSelectedSubscription!: Subscription;
  isOptionSelected = false;
  selectionMessage = '';

  isNextButtonEnabled = false;
  showFeedback = false;
  correctAnswersText = '';

  private destroy$ = new Subject<void>();

  constructor(
    private nextButtonStateService: NextButtonStateService,
    private quizService: QuizService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    private selectionMessageService: SelectionMessageService,
  ) {}

  initializeAnswerSync(
    onNextButtonEnabled: (enabled: boolean) => void,
    onOptionSelected: (selected: boolean) => void,
    onSelectionMessageChanged: (message: string) => void,
    destroy$: Subject<void>
  ): void {
    this.subscribeToOptionSelection();

    // Initialize next button logic
    this.nextButtonStateService.initializeNextButtonStateStream(
      this.selectedOptionService.isAnswered$,
      this.quizStateService.isLoading$,
      this.quizStateService.isNavigating$,
      this.quizStateService.interactionReady$
    );

    // Next button enabled state
    this.selectedOptionService.isNextButtonEnabled$
      .pipe(takeUntil(destroy$))
      .subscribe(onNextButtonEnabled);

    // Option selected state
    this.selectedOptionService
      .isOptionSelected$()
      .pipe(takeUntil(destroy$))
      .subscribe(onOptionSelected);

    // Selection message
    this.selectionMessageService.selectionMessage$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(destroy$))
      .subscribe(onSelectionMessageChanged);

    this.subscribeToSelectionMessage();
  }

  private subscribeToOptionSelection(): void {
    this.optionSelectedSubscription = this.selectedOptionService
      .isOptionSelected$()
      .pipe(takeUntil(this.destroy$))
      .subscribe((isSelected: boolean) => {
        this.isOptionSelected = isSelected;
        this.isNextButtonEnabled = isSelected;
      });
  }

  private subscribeToSelectionMessage(): void {
    this.selectionMessageService.selectionMessage$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),  // prevent redundant updates
        takeUntil(this.destroy$),
      )
      .subscribe((message: string) => {
        if (this.selectionMessage !== message) {
          this.selectionMessage = message;
        }
      });
  }

  public updateQuizUIForNewQuestion(
    question: QuizQuestion | null = this.currentQuestion,
  ): void {
    if (!question) {
      console.error(
        '🚨 [updateQuizUIForNewQuestion] Invalid question (null or undefined).'
      );
      return;
    }

    if (!this.selectedQuiz || !Array.isArray(this.selectedQuiz.questions)) {
      console.warn(
        '🚧 selectedQuiz or questions not ready yet – skipping UI update'
      );
      return;
    }

    const questionIndex = this.quizService.findQuestionIndex(question);
    if (
      questionIndex < 0 ||
      questionIndex >= this.selectedQuiz.questions.length
    ) {
      console.error(
        '🚨 [updateQuizUIForNewQuestion] Invalid question index:',
        questionIndex
      );
      return;
    }

    // Reset UI elements
    this.selectedOption$.next(null);
  }
}