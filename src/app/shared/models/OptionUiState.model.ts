import { FormGroup } from '@angular/forms';
import { Option } from './Option.model';
import { OptionBindings } from './OptionBindings.model';
import { FeedbackProps } from './FeedbackProps.model';

export interface OptionUiState {
  form: FormGroup;
  type: 'single' | 'multiple';

  optionBindings: OptionBindings[];
  optionsToDisplay: Option[];
  currentQuestionIndex: number;

  feedbackConfigs: Record<string, FeedbackProps>;
  showFeedbackForOption: Record<number, boolean>;
  lastFeedbackOptionId: number;
  lastFeedbackQuestionIndex: number;

  lastClickedOptionId: number | null;
  lastClickTimestamp: number | null;

  freezeOptionBindings: boolean;
  hasUserClicked: boolean;

  showFeedback: boolean;
  selectedOptionHistory: number[];
  selectedOptionMap: Map<number, boolean>;
  perQuestionHistory: Set<number>;
}