import { AchievementDefinition } from '../models/achievement.model';

/**
 * Single source of truth for achievement display metadata. Referenced by the
 * evaluation service and the presentation components — never duplicated.
 */
export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] = [
  { id: 'perfect-score', name: 'Perfect Score', description: 'Earn a 100% score on any quiz.' },
  { id: 'angular-explorer', name: 'Angular Explorer', description: 'Complete every available quiz.' },
  { id: 'beginner-complete', name: 'Beginner Complete', description: 'Complete every Beginner quiz.' },
  { id: 'intermediate-complete', name: 'Intermediate Complete', description: 'Complete every Intermediate quiz.' },
  { id: 'advanced-complete', name: 'Advanced Complete', description: 'Complete every Advanced quiz.' },
  { id: 'angular-master', name: 'Angular Master', description: 'Earn a 100% score on every available quiz.' }
] as const;
