import { Option } from './Option.model';
import { QuizQuestion } from './QuizQuestion.model';
import { SelectedOption } from './SelectedOption.model';

export interface SharedOptionConfig {
  option: Option;
  optionsToDisplay: Option[];
  selectedOption: SelectedOption | null;
  currentQuestion: QuizQuestion | null;
  showFeedback: boolean;
  type: 'single' | 'multiple';
  idx: number;
  shouldResetBackground: boolean;
  correctMessage: string;
  showCorrectMessage: boolean;
  feedback: string;
  showFeedbackForOption: { [optionId: number]: boolean };
  explanationText: string;
  showExplanation: boolean;
  isOptionSelected: boolean;
  selectedOptionIndex: number | null;
  isAnswerCorrect: boolean;
  highlightCorrectAfterIncorrect: boolean;
  highlight?: boolean;
  /* quizQuestionComponentOnOptionClicked: (
    option: SelectedOption,
    index: number,
  ) => void;
  onOptionClicked: (
    option: Option,
    index: number,
    checked: boolean,
  ) => Promise<void>;
  onQuestionAnswered: (event: any) => void; */
}
