import { Injectable } from '@angular/core';
import { Option } from '../models/Option.model';
import { OptionBindings } from '../models/OptionBindings.model';
import { QuizQuestion } from '../models/QuizQuestion.model';
import { FeedbackProps } from '../models/FeedbackProps.model';
import { OptionInteractionState } from './option-interaction.service';

export interface SharedOptionHost {
  optionBindings: OptionBindings[];
  optionsToDisplay: Option[];
  currentQuestionIndex: number;

  selectedOptionHistory: number[];
  disabledOptionsPerQuestion: Map<number, Set<number>>;
  correctClicksPerQuestion: Map<number, Set<number>>;

  feedbackConfigs: { [key: string]: FeedbackProps };
  showFeedbackForOption: { [optionId: number]: boolean };

  lastFeedbackOptionId: number;
  lastFeedbackQuestionIndex: number;

  lastClickedOptionId: number | null;
  lastClickTimestamp: number | null;

  hasUserClicked: boolean;
  freezeOptionBindings: boolean;
  showFeedback: boolean;
  disableRenderTrigger: number;

  type: 'single' | 'multiple';
  currentQuestion: QuizQuestion | null;
}

@Injectable({ providedIn: 'root' })
export class SharedOptionStateAdapterService {
  build(host: SharedOptionHost): OptionInteractionState {
    return {
      optionBindings: host.optionBindings,
      optionsToDisplay: host.optionsToDisplay,
      currentQuestionIndex: host.currentQuestionIndex,
      selectedOptionHistory: host.selectedOptionHistory,
      disabledOptionsPerQuestion: host.disabledOptionsPerQuestion,
      correctClicksPerQuestion: host.correctClicksPerQuestion,
      feedbackConfigs: host.feedbackConfigs,
      showFeedbackForOption: host.showFeedbackForOption,
      lastFeedbackOptionId: host.lastFeedbackOptionId,
      lastFeedbackQuestionIndex: host.lastFeedbackQuestionIndex,
      lastClickedOptionId: host.lastClickedOptionId,
      lastClickTimestamp: host.lastClickTimestamp,
      hasUserClicked: host.hasUserClicked,
      freezeOptionBindings: host.freezeOptionBindings,
      showFeedback: host.showFeedback,
      disableRenderTrigger: host.disableRenderTrigger,
      type: host.type,
      currentQuestion: host.currentQuestion
    };
  }

  syncBack(host: SharedOptionHost, state: OptionInteractionState): void {
    host.optionBindings = state.optionBindings;
    host.disableRenderTrigger = state.disableRenderTrigger;
    host.feedbackConfigs = state.feedbackConfigs;
    host.showFeedbackForOption = state.showFeedbackForOption;
    host.lastFeedbackOptionId = state.lastFeedbackOptionId;
    host.lastFeedbackQuestionIndex = state.lastFeedbackQuestionIndex;
    host.lastClickedOptionId = state.lastClickedOptionId;
    host.lastClickTimestamp = state.lastClickTimestamp;
    host.hasUserClicked = state.hasUserClicked;
    host.freezeOptionBindings = state.freezeOptionBindings;
    host.showFeedback = state.showFeedback;
  }
}