import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { forkJoin } from 'rxjs';
import { BiExecutiveSummaryResponse, RevenueCalendarItem } from '../../core/models/bi.model';
import { DateRange } from '../../core/models/date-range.model';
import { BiService } from '../../core/services/bi.service';
import { DateRangeFilterComponent } from '../../shared/components/date-range-filter/date-range-filter.component';
import { KpiCardComponent } from '../../shared/components/kpi-card/kpi-card.component';
import { MarketPositionCellComponent } from '../../shared/components/market-position-cell/market-position-cell.component';
import { ScoreBarComponent } from '../../shared/components/score-bar/score-bar.component';
import { SignalBadgeComponent } from '../../shared/components/signal-badge/signal-badge.component';

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
  selector: 'app-revenue-intelligence-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
    DateRangeFilterComponent,
    KpiCardComponent,
    MarketPositionCellComponent,
    ScoreBarComponent,
    SignalBadgeComponent
  ],
  templateUrl: './revenue-intelligence-page.component.html',
  styleUrl: './revenue-intelligence-page.component.scss'
})
export class RevenueIntelligencePageComponent {
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly dateRange = signal<DateRange>(defaultRange(89));
  readonly summary = signal<BiExecutiveSummaryResponse | null>(null);
  readonly calendar = signal<RevenueCalendarItem[]>([]);
  readonly selectedDate = signal<RevenueCalendarItem | null>(null);
  readonly lastUpdated = signal('');

  readonly topOpportunities = computed(() => this.summary()?.top_opportunities ?? []);
  readonly topRisks = computed(() => this.summary()?.top_risks ?? []);
  readonly topPickup = computed(() => this.summary()?.top_pickup ?? []);
  readonly priorityActions = computed(() => {
    return [...this.topOpportunities(), ...this.topRisks()]
      .filter((row, index, rows) => rows.findIndex((item) => item.date === row.date) === index)
      .sort(
        (a, b) =>
          Math.max(b.opportunityScore, b.riskScore) - Math.max(a.opportunityScore, a.riskScore)
      )
      .slice(0, 5);
  });

  constructor(private readonly biService: BiService) {
    this.refresh(this.dateRange());
  }

  onDateRangeApply(dateRange: DateRange): void {
    this.refresh(dateRange);
  }

  onSelectRow(row: RevenueCalendarItem): void {
    this.selectedDate.set(row);
  }

  dayOfWeek(date: string): string {
    const parsed = new Date(`${date}T00:00:00`);
    return parsed.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '').toUpperCase();
  }

  freshnessLabel(): string {
    return this.lastUpdated() ? `Actualizado ${this.lastUpdated()}` : 'Sin actualizacion';
  }

  private refresh(dateRange: DateRange): void {
    this.dateRange.set(dateRange);
    this.loading.set(true);
    this.errorMessage.set(null);

    forkJoin({
      summary: this.biService.getExecutiveSummary(dateRange),
      calendar: this.biService.getRevenueCalendar(dateRange)
    }).subscribe({
      next: ({ summary, calendar }) => {
        this.summary.set(summary);
        this.calendar.set(calendar.items);
        this.selectedDate.set(calendar.items[0] ?? null);
        this.lastUpdated.set(
          new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
        );
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('No fue posible cargar Revenue Command. Verifica backend y datos.');
        this.loading.set(false);
      }
    });
  }
}
