import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { DateRange } from '../../core/models/date-range.model';
import { RecommendationItem } from '../../core/models/recommendation.model';
import { RecommendationsService } from '../../core/services/recommendations.service';
import { DateRangeFilterComponent } from '../../shared/components/date-range-filter/date-range-filter.component';
import { ActionBadgeComponent } from '../../shared/components/action-badge/action-badge.component';

function formatDateISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(daysForward: number): DateRange {
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(startDate.getDate() + daysForward);

  return {
    startDate: formatDateISO(startDate),
    endDate: formatDateISO(endDate)
  };
}

@Component({
  selector: 'app-recommendations-page',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTableModule,
    DateRangeFilterComponent,
    ActionBadgeComponent
  ],
  templateUrl: './recommendations-page.component.html',
  styleUrl: './recommendations-page.component.scss'
})
export class RecommendationsPageComponent {
  readonly loading = signal(false);
  readonly items = signal<RecommendationItem[]>([]);
  readonly dateRange = signal<DateRange>(defaultRange(13));

  readonly displayedColumns = [
    'date',
    'action',
    'suggested_price',
    'occupancy',
    'your_price',
    'market_average',
    'explanation'
  ];

  constructor(private readonly recommendationsService: RecommendationsService) {
    this.refresh(this.dateRange());
  }

  onDateRangeApply(dateRange: DateRange): void {
    this.refresh(dateRange);
  }

  onRefreshClick(): void {
    this.refresh(this.dateRange());
  }

  private refresh(dateRange: DateRange): void {
    this.dateRange.set(dateRange);
    this.loading.set(true);

    this.recommendationsService.getRecommendations(dateRange).subscribe({
      next: (response) => {
        this.items.set(response.items);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }
}
