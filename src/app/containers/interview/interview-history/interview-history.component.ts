import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  ViewEncapsulation
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

import { formatDuration } from '../../../shared/utils/format-time';
import { InterviewAttemptHistoryEntry } from '../../../shared/models/interview-history.model';
import {
  filterAttempts,
  InterviewHistoryFilter,
  InterviewHistoryService
} from '../../../shared/services/features/interview/interview-history.service';
import { ThemeToggleComponent } from '../../../components/theme-toggle/theme-toggle.component';

interface HistoryCard {
  entry: InterviewAttemptHistoryEntry;
  number: number;          // chronological attempt number (1 = oldest retained)
  topics: string[];
}

/**
 * Interview History — a read-only record of completed Interview Mode attempts.
 * It NEVER touches localStorage directly: all persistence/validation/retention
 * lives in InterviewHistoryService, and the summary metrics reuse that service's
 * `trends` (no independent recalculation). Filtering is client-side and pure.
 *
 * This is purely historical — it never restores or resumes a session.
 */
@Component({
  selector: 'codelab-interview-history',
  standalone: true,
  imports: [CommonModule, RouterLink, ThemeToggleComponent],
  templateUrl: './interview-history.component.html',
  styleUrls: ['./interview-history.component.scss'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InterviewHistoryComponent {
  private readonly history = inject(InterviewHistoryService);

  // Summary metrics — reuse the shared trends (same source as Performance Trends).
  readonly trends = this.history.trends;
  readonly hasHistory = computed(() => this.history.history().length > 0);

  readonly filter = signal<InterviewHistoryFilter>('all');

  readonly filters: { id: InterviewHistoryFilter; label: string }[] = [
    { id: 'all', label: $localize`All` },
    { id: 'submitted', label: $localize`Submitted` },
    { id: 'time-expired', label: $localize`Time Expired` }
  ];

  // Per-filter counts for the filter chips.
  readonly counts = computed<Record<InterviewHistoryFilter, number>>(() => {
    const all = this.history.history();
    return {
      all: all.length,
      submitted: all.filter((a) => a.completionReason === 'submitted').length,
      'time-expired': all.filter((a) => a.completionReason === 'time-expired').length
    };
  });

  // Cards, newest first. The number is the persisted lifetime attempt number
  // (stable as older attempts age out); falls back to chronological position for
  // any legacy record still missing one.
  readonly cards = computed<HistoryCard[]>(() => {
    const all = this.history.history();
    const positionById = new Map(all.map((e, i) => [e.id, i + 1]));
    return filterAttempts(all, this.filter())
      .slice()
      .reverse()
      .map((entry) => ({
        entry,
        number: entry.attemptNumber ?? positionById.get(entry.id) ?? 0,
        topics: this.topicsFor(entry)
      }));
  });

  setFilter(id: InterviewHistoryFilter): void {
    this.filter.set(id);
  }

  completionLabel(entry: InterviewAttemptHistoryEntry): string {
    return entry.completionReason === 'time-expired'
      ? $localize`Time expired`
      : $localize`Submitted`;
  }

  // An unretained duration reads as "Not recorded" — never a misleading "0s".
  duration(seconds: number | undefined): string {
    return seconds == null ? $localize`Not recorded` : formatDuration(seconds);
  }

  /** "July 23, 2026" — locale-formatted, safe fallback for odd input. */
  formatDate(iso: string): string {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      return iso;
    }
  }

  private topicsFor(entry: InterviewAttemptHistoryEntry): string[] {
    const fromPerf = entry.topicPerformance.map((t) => t.topicName).filter(Boolean);
    if (fromPerf.length > 0) return fromPerf;
    return [...(entry.selectedTopicIds ?? [])];
  }
}
