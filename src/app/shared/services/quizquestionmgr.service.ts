import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';

import { Option } from '../models/Option.model';
import { QuizQuestion } from '../models/QuizQuestion.model';

@Injectable({ providedIn: 'root' })
export class QuizQuestionManagerService {
  private shouldDisplayExplanationSubject = new BehaviorSubject<boolean>(false);
  shouldDisplayExplanation$ =
    this.shouldDisplayExplanationSubject.asObservable();

  private explanationTextSubject: BehaviorSubject<string | null> =
    new BehaviorSubject<string | null>(null);

  selectedOption: Option | null = null;
  explanationText = '';

  setExplanationText(explanation: string): void {
    this.explanationTextSubject.next(explanation);
    this.shouldDisplayExplanationSubject.next(!!explanation);
  }

  getNumberOfCorrectAnswersText(
    numberOfCorrectAnswers: number | undefined,
    totalOptions: number | undefined,
  ): string {
    if ((numberOfCorrectAnswers ?? 0) === 0) {
      return 'No correct answers';
    }

    if (!totalOptions || totalOptions <= 0) {
      return numberOfCorrectAnswers === 1
        ? '(1 answer is correct)'
        : `(${numberOfCorrectAnswers} answers are correct)`;
    }

    const pluralSuffix =
      numberOfCorrectAnswers === 1 ? 'answer is' : 'answers are';
    return `(${numberOfCorrectAnswers} ${pluralSuffix} correct)`;
  }

  calculateNumberOfCorrectAnswers(options: Option[]): number {
    const validOptions = options ?? [];
    return validOptions.reduce(
      (count, option) => count + (option.correct ? 1 : 0),
      0,
    );
  }

  public isMultipleAnswerQuestion(question: QuizQuestion): Observable<boolean> {
    try {
      if (question && Array.isArray(question.options)) {
        const correctAnswersCount = question.options.filter(
          (option) => option.correct,
        ).length;
        const hasMultipleAnswers = correctAnswersCount > 1;
        return of(hasMultipleAnswers);
      } else {
        return of(false);
      }
    } catch (error) {
      console.error(
        'Error determining if it is a multiple-answer question:',
        error,
      );
      return of(false);
    }
  }

  isValidQuestionData(questionData: QuizQuestion): boolean {
    return !!questionData && !!questionData.explanation;
  }
}
