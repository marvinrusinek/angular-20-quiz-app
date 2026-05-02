import { Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { combineLatest, of } from 'rxjs';
import { catchError, filter, take, tap } from 'rxjs/operators';

import { Option } from '../../models/Option.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuizService } from '../data/quiz.service';

@Injectable({ providedIn: 'root' })
export class RenderStateService {
  /** Signal-first source of truth */
  readonly optionsToDisplaySig = signal<Option[]>([]);
  private readonly optionsToDisplay$ = toObservable(this.optionsToDisplaySig);

  private readonly combinedQuestionDataSig = signal<{
    question: QuizQuestion;
    options: Option[];
  } | null>(null);

  private readonly renderGateSig = signal<boolean>(false);

  constructor(private quizService: QuizService) {}

  public setupRenderGateSync(): void {
    combineLatest([
      this.quizService.currentQuestionIndex$,
      this.quizService.questionData$,
      this.optionsToDisplay$
    ])
      .pipe(
        filter(
          ([index, question, options]) =>
            !!question &&
            Array.isArray(options) &&
            options.length > 0 &&
            question.questionIndex === index
        ),
        take(1),  // only care about first render (Q1)
        tap(([index, question, options]) => {
          this.combinedQuestionDataSig.set({ question, options });
          this.renderGateSig.set(true);  // tells the template it's safe to render
        }),
        catchError(() => {
          return of(null);
        }),
      )
      .subscribe();
  }
}
