import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  ViewEncapsulation
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import { formatDuration } from '../../../shared/utils/format-time';
import { InterviewResult } from '../../../shared/models/InterviewResult.model';
import { InterviewDifficulty } from '../../../shared/models/AssessmentConfig.model';
import { InterviewAttemptHistoryEntry } from '../../../shared/models/interview-history.model';
import { InterviewHistoryService } from '../../../shared/services/features/interview/interview-history.service';
import { InterviewAnalyticsService } from '../../../shared/services/features/interview/interview-analytics.service';
import { ThemeToggleComponent } from '../../../components/theme-toggle/theme-toggle.component';
import { TopicPerformanceListComponent } from '../../../components/interview/topic-performance/topic-performance-list.component';

/**
 * Read-only historical Interview summary. Reopens the details for ONE past
 * attempt (by id) from the shared InterviewHistoryService — it reconstructs an
 * InterviewResult from the compact stored analytics purely to reuse
 * InterviewAnalyticsService + the Topic Performance presentation.
 *
 * Strictly historical + read-only: no session, no timer, no answer controls, no
 * path back into an active interview. Per-question answer review is NOT retained
 * in history (compact-storage design), so the page says so explicitly.
 */
@Component({
  selector: 'codelab-interview-history-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, ThemeToggleComponent, TopicPerformanceListComponent],
  templateUrl: './interview-history-detail.component.html',
  styleUrls: ['./interview-history-detail.component.scss'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InterviewHistoryDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly history = inject(InterviewHistoryService);
  private readonly analyticsService = inject(InterviewAnalyticsService);

  private readonly params = toSignal(this.route.paramMap, { initialValue: null });
  readonly id = computed(() => this.params()?.get('id') ?? null);

  // The requested attempt + its chronological position, or null if not found.
  readonly found = computed(() => {
    const all = this.history.history();
    const id = this.id();
    const index = all.findIndex((e) => e.id === id);
    if (index === -1) return null;
    return { entry: all[index], number: index + 1, total: all.length };
  });

  readonly entry = computed<InterviewAttemptHistoryEntry | null>(() => this.found()?.entry ?? null);

  // Reconstruct a result to reuse the analytics pipeline (topic bands, highlights).
  readonly analytics = computed(() => {
    const e = this.entry();
    return e ? this.analyticsService.analyze(toResult(e)) : null;
  });

  // Performance context — reuse the shared trends (no independent recalculation).
  readonly trends = this.history.trends;

  duration(seconds: number | undefined): string {
    return formatDuration(seconds ?? 0);
  }

  completionLabel(entry: InterviewAttemptHistoryEntry): string {
    return entry.completionReason === 'time-expired'
      ? $localize`Time expired`
      : $localize`Submitted`;
  }

  /** "July 21, 2026" — locale-formatted, safe fallback. */
  formatDate(iso: string): string {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      return iso;
    }
  }
}

// Reconstruct an InterviewResult from a compact history entry. Only the fields
// the historical summary actually displays are meaningful; answered/unanswered
// and focusChanges are not retained and are not shown.
function toResult(e: InterviewAttemptHistoryEntry): InterviewResult {
  return {
    total: e.totalQuestions,
    answered: e.totalQuestions,
    unanswered: 0,
    correct: e.score,
    incorrect: Math.max(0, e.totalQuestions - e.score),
    percentage: e.percentage,
    timeUsedSeconds: e.durationSeconds ?? 0,
    timeRemainingSeconds: 0,
    difficulty: (e.configuredDifficulty ?? 'mixed') as InterviewDifficulty,
    topicIds: [...(e.selectedTopicIds ?? [])],
    perTopic: e.topicPerformance.map((t) => ({
      quizId: t.topicId,
      title: t.topicName,
      correct: t.correct,
      total: t.total,
      percentage: t.percentage
    })),
    submittedByExpiry: e.completionReason === 'time-expired',
    focusChanges: 0
  };
}
