/**
 * SINGLE source of truth for how the Interview Builder groups Topics into
 * categories. Presentation metadata only — it never affects which quizzes are
 * eligible, how questions are selected, difficulty, or validation. The builder
 * renders from this list, so adding a new quiz means adding its quizId to the
 * right category here (or it falls into an "Other" bucket, never disappearing).
 *
 * Order matters: categories render top-to-bottom in this order, and topics
 * within a category render in the order listed here.
 */
export interface InterviewTopicCategory {
  /** Visible heading. */
  readonly title: string;
  /** quizIds (catalog ids) that belong to this category, in display order. */
  readonly quizIds: readonly string[];
}

export const INTERVIEW_TOPIC_CATEGORIES: readonly InterviewTopicCategory[] = [
  {
    title: 'Core Angular',
    quizIds: [
      'typescript',
      'create-first-app',
      'templates',
      'directives',
      'pipes',
      'forms',
      'router',
      'angular-cli'
    ]
  },
  {
    title: 'Components & Architecture',
    quizIds: ['component-tree', 'component-architecture', 'design-patterns']
  },
  {
    title: 'Dependency Injection',
    quizIds: ['dependency-injection', 'dependency-injection-advanced']
  },
  {
    title: 'Reactive Angular',
    quizIds: ['rxjs', 'signals', 'change-detection']
  },
  {
    title: 'Data, UI & Quality',
    // 'security' is listed for forward-compatibility; if no such quiz exists it
    // is simply skipped (categories only render topics that are available).
    quizIds: ['http', 'material', 'testing', 'performance', 'security']
  }
];

/** Fallback heading for any available topic not assigned to a category above. */
export const INTERVIEW_TOPIC_OTHER_CATEGORY = 'Other';
