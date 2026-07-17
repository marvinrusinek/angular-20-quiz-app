import { GeneratedAssessment } from '../models/GeneratedAssessment.model';
import { Option } from '../models/Option.model';
import { computeInterviewResult } from './interview-scoring';

function makeQuestion(sourceQuizId: string, correctIds: number[], optionIds: number[]) {
  const options: Option[] = optionIds.map((id) => ({
    text: `opt-${id}`,
    optionId: id,
    correct: correctIds.includes(id)
  }));
  return { questionText: `q-${sourceQuizId}`, explanation: 'e', sourceQuizId, options };
}

const assessment: GeneratedAssessment = {
  id: 'interview-1',
  title: 'Angular Assessment',
  config: { difficulty: 'mixed', topicIds: ['a', 'b'], questionCount: 10 },
  durationSeconds: 900,
  questions: [
    makeQuestion('a', [1], [1, 2, 3, 4]),        // single-answer, correct = 1
    makeQuestion('a', [10, 11], [10, 11, 12]),   // multi-answer, correct = {10,11}
    makeQuestion('b', [20], [20, 21])            // single-answer, correct = 20
  ]
};

const titleFor = (id: string) => id.toUpperCase();

describe('computeInterviewResult', () => {
  it('scores single + multi answers and builds per-topic breakdown', () => {
    const answers = { 0: [1], 1: [10, 11], 2: [21] };   // correct, correct, wrong
    const r = computeInterviewResult(assessment, answers, 120, 780, false, titleFor);

    expect(r.total).toBe(3);
    expect(r.answered).toBe(3);
    expect(r.unanswered).toBe(0);
    expect(r.correct).toBe(2);
    expect(r.incorrect).toBe(1);
    expect(r.percentage).toBe(67);
    expect(r.timeUsedSeconds).toBe(120);
    expect(r.timeRemainingSeconds).toBe(780);
    expect(r.difficulty).toBe('mixed');
    expect(r.perTopic).toEqual(expect.arrayContaining([
      expect.objectContaining({ quizId: 'a', title: 'A', correct: 2, total: 2, percentage: 100 }),
      expect.objectContaining({ quizId: 'b', title: 'B', correct: 0, total: 1, percentage: 0 })
    ]));
  });

  it('treats a partial multi-answer selection as incorrect', () => {
    const answers = { 0: [1], 1: [10], 2: [20] };       // q1 only 1 of 2 correct
    const r = computeInterviewResult(assessment, answers, 0, 900, false, titleFor);
    expect(r.correct).toBe(2);   // q0 + q2 only
    expect(r.incorrect).toBe(1);
  });

  it('counts unanswered separately and records expiry submission', () => {
    const answers = { 0: [1] };                          // only q0 answered
    const r = computeInterviewResult(assessment, answers, 900, 0, true, titleFor);
    expect(r.answered).toBe(1);
    expect(r.unanswered).toBe(2);
    expect(r.correct).toBe(1);
    expect(r.incorrect).toBe(0);
    expect(r.submittedByExpiry).toBe(true);
  });
});
