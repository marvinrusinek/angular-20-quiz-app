import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, of } from 'rxjs';
import { catchError, filter, take, tap } from 'rxjs/operators';

import { Option } from '../models/Option.model';
import { QuizQuestion } from '../models/QuizQuestion.model';
import { QuizService } from './quiz.service';

@Injectable({ providedIn: 'root' })
export class RenderStateService {
  public optionsToDisplay$ = new BehaviorSubject<Option[]>([]);

  private combinedQuestionDataSubject = new BehaviorSubject<{
    question: QuizQuestion,
    options: Option[]
  } | null>(null);

  private renderGateSubject = new BehaviorSubject<boolean>(false);

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
          console.log('[RenderGate Triggered]', {
            index,
            question,
            options
          });
          this.combinedQuestionDataSubject.next({ question, options });
          this.renderGateSubject.next(true);  // tells the template it's safe to render
        }),
        catchError((error) => {
          console.error('[RenderGateSync Error]', error);
          return of(null);
        }),
      )
      .subscribe();
  }
}
