import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { forkJoin } from 'rxjs';
import {
  BiExecutiveSummaryResponse,
  BiRecommendationAction,
  BiSeverity,
  RevenueCalendarItem,
} from '../../core/models/bi.model';
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
    endDate: formatDateISO(endDate),
  };
}

type SignalFilter = 'all' | 'opportunity' | 'risk' | 'pickup' | 'comp-set';

@Component({
  selector: 'app-revenue-intelligence-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTableModule,
    DateRangeFilterComponent,
    KpiCardComponent,
    MarketPositionCellComponent,
    ScoreBarComponent,
    SignalBadgeComponent,
  ],
  templateUrl: './revenue-intelligence-page.component.html',
  styleUrl: './revenue-intelligence-page.component.scss',
})
export class RevenueIntelligencePageComponent {
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly dateRange = signal<DateRange>(defaultRange(89));
  readonly summary = signal<BiExecutiveSummaryResponse | null>(null);
  readonly calendar = signal<RevenueCalendarItem[]>([]);
  readonly signalFilter = signal<SignalFilter>('all');
  readonly selectedDate = signal<RevenueCalendarItem | null>(null);
  readonly lastUpdated = signal<string>('');

  readonly displayedColumns = [
    'date',
    'dow',
    'arrival',
    'occupancy',
    'pickup',
    'adr',
    'revenue',
    'price',
    'marketAverage',
    'gap',
    'rank',
    'opportunity',
    'risk',
    'action',
  ];

  readonly filteredCalendar = computed(() => {
    const filter = this.signalFilter();
    const rows = this.calendar();

    if (filter === 'all') {
      return rows;
    }
    if (filter === 'opportunity') {
      return rows.filter((row) => row.opportunityScore >= 55);
    }
    if (filter === 'risk') {
      return rows.filter((row) => row.riskScore >= 55);
    }
    if (filter === 'pickup') {
      return rows.filter((row) =>
        row.signals.some((signal) =>
          ['accelerated-demand', 'fast-filling-date', 'no-recent-pickup'].includes(signal.type),
        ),
      );
    }

    return rows.filter((row) =>
      row.signals.some((signal) =>
        [
          'price-below-comp-set',
          'price-above-comp-set',
          'high-demand-low-price',
          'low-demand-high-price',
          'competitor-aggressive-drop',
        ].includes(signal.type),
      ),
    );
  });

  readonly topOpportunities = computed(() => this.summary()?.top_opportunities ?? []);
  readonly topRisks = computed(() => this.summary()?.top_risks ?? []);
  readonly topPickup = computed(() => this.summary()?.top_pickup ?? []);
  readonly priorityActions = computed(() => {
    return [...this.topOpportunities(), ...this.topRisks()]
      .filter((row, index, rows) => rows.findIndex((item) => item.date === row.date) === index)
      .sort(
        (a, b) =>
          Math.max(b.opportunityScore, b.riskScore) - Math.max(a.opportunityScore, a.riskScore),
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

  severityClass(severity: BiSeverity): string {
    return `badge-${severity}`;
  }

  actionLabel(action: BiRecommendationAction): string {
    const labels: Record<BiRecommendationAction, string> = {
      'increase-slightly': 'Subir ligero',
      'increase-aggressively': 'Subir fuerte',
      hold: 'Mantener',
      'review-promotion': 'Revisar promo',
      'decrease-moderately': 'Bajar moderado',
      'investigate-low-demand': 'Investigar baja',
      'monitor-competition': 'Monitorear comp',
    };

    return labels[action];
  }

  scoreTone(score: number): string {
    if (score >= 70) {
      return 'high';
    }
    if (score >= 45) {
      return 'medium';
    }
    return 'low';
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
      calendar: this.biService.getRevenueCalendar(dateRange),
    }).subscribe({
      next: ({ summary, calendar }) => {
        this.summary.set(summary);
        this.calendar.set(calendar.items);
        this.selectedDate.set(calendar.items[0] ?? null);
        this.lastUpdated.set(
          new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }),
        );
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set(
          'No fue posible cargar Revenue Intelligence. Verifica backend y datos.',
        );
        this.loading.set(false);
      },
    });
  }
}
