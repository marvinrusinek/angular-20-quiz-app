import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit,
  signal, computed
} from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { ActivatedRoute, Params, Router } from '@angular/router';
import {
  FormBuilder, FormGroup, FormsModule, ReactiveFormsModule
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleChange, MatSlideToggleModule }
  from '@angular/material/slide-toggle';
import {
  BehaviorSubject, combineLatest, EMPTY, firstValueFrom, of, Subject
} from 'rxjs';
import { catchError, filter, switchMap, takeUntil, tap } from 'rxjs/operators';

import { Quiz } from '../../shared/models/Quiz.model';
import { QuizQuestion } from '../../shared/models/QuizQuestion.model';
import { QuizService } from '../../shared/services/data/quiz.service';
import { QuizDataService } from '../../shared/services/data/quizdata.service';
import { QuizShuffleService } from '../../shared/services/flow/quiz-shuffle.service';
import { QuizNavigationService } from '../../shared/services/flow/quiz-navigation.service';
import { SelectedOptionService } from '../../shared/services/state/selectedoption.service';

@Component({
  selector: 'codelab-quiz-intro',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatSlideToggleModule,
    NgOptimizedImage,
    ReactiveFormsModule
  ],
  templateUrl: './introduction.component.html',
  styleUrls: ['./introduction.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class IntroductionComponent implements OnInit, OnDestroy {
  quiz!: Quiz;
  quizId: string | undefined;
  selectedQuiz: Quiz | null = null;
  selectedQuiz$ = new BehaviorSubject<Quiz | null>(null);
  preferencesForm: FormGroup;
  private isCheckedSubject = new BehaviorSubject<boolean>(false);
  readonly isStartingQuiz = signal(false);
  readonly questionCountSig = signal(0);
  readonly questionLabelSig = computed(() =>
    this.questionCountSig() === 1 ? 'question' : 'questions'
  );

  shuffledQuestions: QuizQuestion[] = [];
  shouldShuffleOptions = false;

  highlightPreference = false;
  isImmediateFeedback = false;

  questionLabel = '';
  introImg = '';
  imagePath = '../../../assets/images/milestones/';

  private destroy$ = new Subject<void>();

  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private quizShuffleService: QuizShuffleService,
    private quizNavigationService: QuizNavigationService,
    private selectedOptionService: SelectedOptionService,
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private ngZone: NgZone,
    private cdRef: ChangeDetectorRef
  ) {
    // Initialize the form group with default values
    this.preferencesForm = this.fb.group({
      shouldShuffleOptions: [false],
      isImmediateFeedback: [false]
    });
  }

  ngOnInit(): void {
    this.quizService.clearStoredCorrectAnswersText();
    this.subscribeToRouteParameters();
    this.handleQuizSelectionAndFetchQuestions();

    this.selectedQuiz$
      .pipe(
        takeUntil(this.destroy$),
        filter((quiz) => quiz !== null)  // proceed only if there's a valid quiz
      )
      .subscribe(() => {
        this.cdRef.markForCheck();
      });

    this.preferencesForm.get('shouldShuffleOptions')!
      .valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((isChecked: boolean) => {
        this.highlightPreference = isChecked;
        this.shouldShuffleOptions = isChecked;
        this.quizService.setCheckedShuffle(isChecked);
        this.isCheckedSubject.next(isChecked);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private subscribeToRouteParameters(): void {
    this.activatedRoute.params
      .pipe(
        tap((params) => this.handleRouteParams(params)),
        switchMap((params) => this.fetchQuiz(params)),
        tap((quiz) => this.logQuizLoaded(quiz)),
        takeUntil(this.destroy$),
      )
      .subscribe({
        next: (quiz: Quiz | null) => this.handleLoadedQuiz(quiz),
        error: (error) => this.handleError(error),
      });
  }

  private handleRouteParams(params: Params): void {
    this.quizId = params['quizId'];
  }

  private fetchQuiz(params: Params) {
    const quizId = params['quizId'];
    if (!quizId) {
      console.error('No quiz ID found in route parameters');
      return EMPTY;  // return EMPTY if no quizId is available
    }

    return this.quizDataService.getQuiz(quizId).pipe(
      catchError((error) => {
        console.error('Error fetching quiz:', error);
        return EMPTY;  // handle the error by returning EMPTY to keep the Observable flow intact
      }),
    );
  }

  private logQuizLoaded(quiz: Quiz | null): void {
    if (!quiz) {
      console.error('Quiz is undefined or null after fetching.');
    }
  }

  private handleLoadedQuiz(quiz: Quiz | null): void {
    if (quiz) {
      this.selectedQuiz$.next(quiz);
      this.quiz = quiz;
      this.introImg = this.imagePath + quiz.image;
      this.questionCountSig.set(quiz.questions?.length ?? 0);
      this.questionLabel = this.getPluralizedQuestionLabel(
        quiz.questions?.length ?? 0
      );
      this.cdRef.markForCheck();
    } else {
      console.error('Quiz is undefined or null.');
    }
  }

  private handleError(error: any): void {
    console.error('Error loading quiz:', error);
  }

  private handleQuizSelectionAndFetchQuestions(): void {
    combineLatest([this.selectedQuiz$, this.isCheckedSubject])
      .pipe(
        takeUntil(this.destroy$),
        // Narrow the entire tuple: [Quiz, boolean]
        filter((tuple): tuple is [Quiz, boolean] => !!tuple[0]),
        tap(([quiz, checked]) => {
          this.shouldShuffleOptions = checked;
          this.fetchAndHandleQuestions(quiz.quizId);
        })
      )
      .subscribe();
  }

  private fetchAndHandleQuestions(quizId: string): void {
    this.quizDataService
      .getQuestionsForQuiz(quizId)
      .pipe(
        switchMap((questions: QuizQuestion[]) => {
          // NOTE: Shuffle is handled by quiz.service.ts fetchQuizQuestions()
          // Do NOT shuffle here - it would break question-option correspondence
          return of(questions);
        }),
        catchError((error: Error) => {
          console.error('Failed to load questions for quiz:', error);
          return of([]);
        }),
        takeUntil(this.destroy$)
      )
      .subscribe((questions: QuizQuestion[]) => {
        this.shuffledQuestions = questions;
        this.cdRef.markForCheck();
      });
  }

  onSlideToggleChange(event: MatSlideToggleChange): void {
    const isChecked = event.checked;
    this.highlightPreference = isChecked;
    this.shouldShuffleOptions = isChecked;
    this.quizService.setCheckedShuffle(isChecked);
    this.isCheckedSubject.next(isChecked);
  }

  async onStartQuiz(quizId?: string): Promise<void> {
    if (this.isStartingQuiz()) {
      return;
    }

    this.isStartingQuiz.set(true);
    this.cdRef.markForCheck();

    try {
      const targetQuizId = quizId ?? this.quizId ?? this.getStoredQuizId();
      if (!targetQuizId) {
        console.error('Quiz data is not ready.');
        return;
      }

      // Clear cache before starting to ensure fresh shuffle with correct flag
      this.quizDataService.clearQuizQuestionCache(targetQuizId);
      this.quizShuffleService.clear(targetQuizId);  // clear shuffle state to force fresh shuffle

      this.quizService.resetQuizSessionState();

      const activeQuiz = await this.resolveActiveQuiz(targetQuizId);
      if (!activeQuiz) {
        console.error(
          'Unable to start quiz because quiz data could not be loaded.'
        );
        return;
      }

      // Retrieve form values
      const preferences = this.preferencesForm.value;
      console.log('Form Preferences:', preferences);

      // Access individual preferences from the form
      const shouldShuffleOptions = preferences.shouldShuffleOptions;

      this.quizDataService.setSelectedQuiz(activeQuiz);
      this.quizService.setSelectedQuiz(activeQuiz);
      this.quizService.setActiveQuiz(activeQuiz);
      this.persistQuizId(targetQuizId);
      this.quizService.setCheckedShuffle(shouldShuffleOptions);
      this.quizService.setQuizId(targetQuizId);
      this.quizService.setCurrentQuestionIndex(0);

      // Hard fresh-start reset for same-tab runs before entering Q1.
      // Prevent stale score like 1/6 from previous attempts.
      this.quizService.resetScore();
      this.quizService.questionCorrectness.clear();
      this.quizService.selectedOptionsMap.clear();
      this.quizService.userAnswers = [];
      this.quizService.answers = [];
      this.selectedOptionService.clearAllSelectionsForQuiz(targetQuizId);
      try {
        localStorage.setItem('savedQuestionIndex', '0');
        localStorage.setItem('correctAnswersCount', '0');
        localStorage.removeItem('questionCorrectness');
        localStorage.removeItem('selectedOptionsMap');
        localStorage.removeItem('userAnswers');
        sessionStorage.removeItem('selectedOptionsMap');
        sessionStorage.removeItem('rawSelectionsMap');
        sessionStorage.removeItem('selectionHistory');
        sessionStorage.removeItem('isAnswered');
        sessionStorage.removeItem('finalResult');
        sessionStorage.removeItem('elapsedTimes');
        sessionStorage.removeItem('completionTime');
        // Clear per-question sessionStorage entries from previous quiz
        for (let i = 0; i < 20; i++) {
          sessionStorage.removeItem('sel_Q' + i);
          sessionStorage.removeItem('dot_confirmed_' + i);
          sessionStorage.removeItem('quiz_selection_' + i);
          sessionStorage.removeItem('displayMode_' + i);
          sessionStorage.removeItem('feedbackText_' + i);
        }
      } catch {}

      try {
        const preparedQuestions = (await firstValueFrom(
          this.quizDataService.prepareQuizSession(targetQuizId),
        )) as QuizQuestion[];

        // Now set current quiz with the SHUFFLED questions
        const quizWithShuffledQuestions = {
          ...activeQuiz,
          questions: preparedQuestions ?? activeQuiz.questions
        };
        this.quizDataService.setCurrentQuiz(quizWithShuffledQuestions);
        console.log(`[IntroComponent] Set currentQuiz with ${preparedQuestions?.length ?? 0} shuffled questions`);
      } catch (error) {
        console.error('Failed to prepare quiz session:', error);
        // Fallback: set with original questions if shuffle fails
        this.quizDataService.setCurrentQuiz(activeQuiz);
      }

      const navigationSucceeded =
        await this.navigateToFirstQuestion(targetQuizId);

      if (!navigationSucceeded) {
        console.error('Navigation to first question was prevented.', {
          quizId: targetQuizId
        });
      }
    } finally {
      this.isStartingQuiz.set(false);
      this.cdRef.markForCheck();
    }
  }

  private async navigateToFirstQuestion(
    targetQuizId: string
  ): Promise<boolean> {
    // Resolve the effective quiz id (override → service → component → localStorage)
    const quizId =
      this.quizNavigationService.resolveEffectiveQuizId(targetQuizId);
    if (!quizId) {
      console.error('[navigateToFirstQuestion] Missing targetQuizId.');
      return false;
    }

    // Ensure the session is ready and can resolve Q0 (best-effort; don’t block nav)
    await this.quizNavigationService.ensureSessionQuestions(quizId);
    const q0 = await this.quizNavigationService.tryResolveQuestion(0);
    if (!q0) {
      console.warn(
        '[navigateToFirstQuestion] Q0 could not be resolved pre-nav (continuing anyway).',
        {
          quizId,
          index: 0
        }
      );
    }

    try {
      // Preferred path: let the service reset UI and navigate to Q1 (index 0)
      const viaService = await this.quizNavigationService.resetUIAndNavigate(
        0,
        quizId
      );
      if (viaService) return true;  // if the service explicitly succeeded, we’re done

      // Service returned false/undefined/non-boolean – fall back to direct navigation
      console.warn(
        '[navigateToFirstQuestion] resetUIAndNavigate did not confirm success; falling back.',
        { viaService }
      );
    } catch (error) {
      console.error('[navigateToFirstQuestion] resetUIAndNavigate threw.', error);
    }

    // Fallback to direct router navigation
    try {
      // Router expects 1-based question in URL; index 0 ⇒ "/.../1"
      const fallbackSucceeded = await this.ngZone.run(() =>
        this.router.navigate(['/quiz/question', quizId, 1]),
      );

      if (!fallbackSucceeded) {
        console.error(
          '[navigateToFirstQuestion] Fallback navigation returned false.',
          { quizId }
        );
      }

      return fallbackSucceeded;
    } catch (fallbackErr) {
      console.error(
        '[navigateToFirstQuestion] Fallback navigation threw.', fallbackErr
      );
      return false;
    }
  }

  private async resolveActiveQuiz(targetQuizId: string): Promise<Quiz | null> {
    const quizFromState = this.selectedQuiz$.getValue() ?? this.quiz ?? null;

    if (quizFromState?.quizId === targetQuizId) {
      return quizFromState;
    }

    try {
      const loadedQuiz = await this.quizDataService.loadQuizById(targetQuizId);
      if (loadedQuiz) {
        this.selectedQuiz$.next(loadedQuiz);
        this.quiz = loadedQuiz;
      }
      return loadedQuiz;
    } catch (error) {
      console.error('Failed to hydrate quiz before starting.', error);
      return null;
    }
  }

  private getStoredQuizId(): string | null {
    try {
      if (typeof localStorage === 'undefined') {
        return null;
      }
      return localStorage.getItem('quizId');
    } catch {
      return null;
    }
  }

  private persistQuizId(quizId: string): void {
    try {
      localStorage.setItem('quizId', quizId);
    } catch (storageError) {
      console.warn('Unable to persist quizId to local storage.', storageError);
    }
  }

  public get milestone(): string {
    return this.selectedQuiz?.milestone || 'Milestone not found';
  }

  public getPluralizedQuestionLabel(count: number): string {
    return `${count === 1 ? 'question' : 'questions'}`;
  }
}