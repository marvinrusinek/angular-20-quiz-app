import { DestroyRef, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { NextButtonStateService } from '../state/next-button-state.service';
import { QuizStateService } from '../state/quizstate.service';
import { SelectedOptionService } from '../state/selectedoption.service';
import { SelectionMessageService } from '../features/selection-message/selection-message.service';

@Injectable({ providedIn: 'root' })
export class QuizInitializationService {
  constructor(
    private nextButtonStateService: NextButtonStateService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    private selectionMessageService: SelectionMessageService
  ) {}

  initializeAnswerSync(
    onNextButtonEnabled: (enabled: boolean) => void,
    onOptionSelected: (selected: boolean) => void,
    onSelectionMessageChanged: (message: string) => void,
    destroyRef: DestroyRef
  ): void {
    this.nextButtonStateService.initializeNextButtonStateStream(
      this.selectedOptionService.isAnswered$,
      this.quizStateService.isLoading$,
      this.quizStateService.isNavigating$,
      destroyRef,
      this.quizStateService.interactionReady$
    );

    this.selectedOptionService.isNextButtonEnabled$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(onNextButtonEnabled);

    this.selectedOptionService
      .isOptionSelected$()
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(onOptionSelected);

    this.selectionMessageService.selectionMessage$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntilDestroyed(destroyRef))
      .subscribe(onSelectionMessageChanged);
  }
}