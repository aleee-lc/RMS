import { CommonModule } from '@angular/common';
import { HttpResponse } from '@angular/common/http';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
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
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTableModule,
    MatTooltipModule,
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
  readonly exporting = signal<'csv' | 'pdf' | null>(null);
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

  readonly headerHelp: Record<string, string> = {
    date: 'Fecha de estancia analizada.',
    dow: 'Dia de la semana.',
    arrival: 'Dias restantes hasta la llegada.',
    occupancy: 'Ocupacion estimada o registrada para la fecha.',
    pickup: 'Room nights capturados en los ultimos 7 dias.',
    adr: 'Tarifa diaria promedio.',
    revenue: 'Ingreso estimado o registrado para la fecha.',
    price: 'Tarifa propia cargada desde PriceGrid.',
    marketAverage: 'Promedio tarifario del set competitivo.',
    gap: 'Diferencia porcentual entre tarifa propia y comp set.',
    rank: 'Posicion tarifaria frente a competidores.',
    opportunity: 'Opportunity Score de 0 a 100.',
    risk: 'Risk Score de 0 a 100.',
    action: 'Recomendacion basada en reglas BI.',
  };

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

  onExportCsv(): void {
    this.exportReport('csv');
  }

  onExportPdf(): void {
    this.exportReport('pdf');
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

  isExporting(type: 'csv' | 'pdf'): boolean {
    return this.exporting() === type;
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

  private exportReport(type: 'csv' | 'pdf'): void {
    this.exporting.set(type);
    this.errorMessage.set(null);

    const request =
      type === 'csv'
        ? this.biService.exportCsv(this.dateRange())
        : this.biService.exportPdf(this.dateRange());

    request.subscribe({
      next: (response) => {
        this.downloadBlob(response, this.fallbackFilename(type));
        this.exporting.set(null);
      },
      error: () => {
        this.errorMessage.set(
          `No fue posible exportar el reporte ${type.toUpperCase()}. Intenta nuevamente.`,
        );
        this.exporting.set(null);
      },
    });
  }

  private downloadBlob(response: HttpResponse<Blob>, fallbackFilename: string): void {
    const blob = response.body;
    if (!blob) {
      throw new Error('Empty export response');
    }

    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download =
      this.filenameFromDisposition(response.headers.get('content-disposition')) ?? fallbackFilename;
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  private filenameFromDisposition(disposition: string | null): string | null {
    const match = disposition?.match(/filename="?([^"]+)"?/i);
    return match?.[1] ?? null;
  }

  private fallbackFilename(type: 'csv' | 'pdf'): string {
    const range = this.dateRange();
    return `revenue-intelligence-${range.startDate}_a_${range.endDate}.${type}`;
  }
}
