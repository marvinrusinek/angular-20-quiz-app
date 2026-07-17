import { GeneratedAssessment } from '../models/GeneratedAssessment.model';
import { InterviewResult, InterviewTopicScore } from '../models/InterviewResult.model';

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

/**
 * Score a submitted assessment from the generated questions + the user's
 * answers. A question is CORRECT only when the selected optionIds exactly match
 * the set of correct optionIds (so a partial multi-answer is incorrect). Topic
 * breakdown is grouped by each question's preserved `sourceQuizId` — never
 * inferred from wording. This reads the assessment only; it never touches
 * topic-quiz progress/best-score/achievement state.
 */
export function computeInterviewResult(
  assessment: GeneratedAssessment,
  answersByIndex: Record<number, number[]>,
  timeUsedSeconds: number,
  timeRemainingSeconds: number,
  submittedByExpiry: boolean,
  titleForQuizId: (quizId: string) => string
): InterviewResult {
  const questions = assessment.questions ?? [];
  const total = questions.length;
  let correct = 0;
  let answered = 0;

  const perTopicMap = new Map<string, { title: string; correct: number; total: number }>();

  questions.forEach((q, i) => {
    const selected = new Set((answersByIndex[i] ?? []).filter((id) => id != null));
    const correctIds = new Set(
      (q.options ?? [])
        .filter((o) => o.correct === true)
        .map((o) => o.optionId)
        .filter((id): id is number => id != null)
    );

    const isAnswered = selected.size > 0;
    if (isAnswered) answered++;
    const isCorrect = isAnswered && setsEqual(selected, correctIds);
    if (isCorrect) correct++;

    const quizId = q.sourceQuizId ?? 'unknown';
    const entry = perTopicMap.get(quizId) ?? { title: titleForQuizId(quizId), correct: 0, total: 0 };
    entry.total++;
    if (isCorrect) entry.correct++;
    perTopicMap.set(quizId, entry);
  });

  const perTopic: InterviewTopicScore[] = [...perTopicMap.entries()].map(([quizId, e]) => ({
    quizId,
    title: e.title,
    correct: e.correct,
    total: e.total,
    percentage: e.total ? Math.round((e.correct / e.total) * 100) : 0
  }));

  return {
    total,
    answered,
    unanswered: total - answered,
    correct,
    incorrect: answered - correct,
    percentage: total ? Math.round((correct / total) * 100) : 0,
    timeUsedSeconds,
    timeRemainingSeconds,
    difficulty: assessment.config.difficulty,
    topicIds: assessment.config.topicIds,
    perTopic,
    submittedByExpiry
  };
}
