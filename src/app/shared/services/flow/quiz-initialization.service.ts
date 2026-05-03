import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

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
    private selectionMessageService: SelectionMessageService,
  ) {}

  initializeAnswerSync(
    onNextButtonEnabled: (enabled: boolean) => void,
    onOptionSelected: (selected: boolean) => void,
    onSelectionMessageChanged: (message: string) => void,
    destroy$: Subject<void>
  ): void {
    this.nextButtonStateService.initializeNextButtonStateStream(
      this.selectedOptionService.isAnswered$,
      this.quizStateService.isLoading$,
      this.quizStateService.isNavigating$,
      destroy$,
      this.quizStateService.interactionReady$
    );

    this.selectedOptionService.isNextButtonEnabled$
      .pipe(takeUntil(destroy$))
      .subscribe(onNextButtonEnabled);

    this.selectedOptionService
      .isOptionSelected$()
      .pipe(takeUntil(destroy$))
      .subscribe(onOptionSelected);

    this.selectionMessageService.selectionMessage$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(destroy$))
      .subscribe(onSelectionMessageChanged);
  }
}
