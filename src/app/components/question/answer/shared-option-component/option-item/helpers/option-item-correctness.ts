import { Option } from '../../../../../../shared/models/Option.model';
import { OptionBindings } from '../../../../../../shared/models/OptionBindings.model';

import { QuizService } from '../../../../../../shared/services/data/quiz.service';

import { isOptionCorrect } from '../../../../../../shared/utils/is-option-correct';
import { norm } from '../../../../../../shared/utils/text-norm';

/**
 * Authoritative correctness check for this option. Prefers the binding's
 * `option.correct` / `binding.isCorrect`. Falls back to matching by text
 * against the live question's options — binding options can lose the
 * `correct` flag after regeneration paths.
 */
export function isCurrentOptionCorrect(
  binding: OptionBindings | undefined,
  quizService: QuizService,
  qIdx: number
): boolean {
  const opt = binding?.option as any;
  if (isOptionCorrect(opt) || binding?.isCorrect === true) return true;

  // SHUFFLE-AWARE: in shuffle mode `questions[qIdx]` is the WRONG question
  // (qIdx is the DISPLAY index). Read from the display-order array so an
  // unselected option can't text-match a same-named correct option in a
  // different question and get wrongly painted green on timeout.
  const svc = quizService as any;
  const isShuf = svc?.isShuffleEnabled?.()
    && Array.isArray(svc?.shuffledQuestions)
    && svc.shuffledQuestions.length > 0;
  const question = isShuf ? svc?.shuffledQuestions?.[qIdx] : svc?.questions?.[qIdx];
  if (question?.options && opt?.text) {
    const optText = norm(opt.text);
    const match = question.options.find(
      (o: Option) => o?.text && norm(o.text) === optText
    );
    if (isOptionCorrect(match)) return true;
  }
  return false;
}
