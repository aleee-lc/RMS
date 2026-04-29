import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { catchError, forkJoin, map, of } from 'rxjs';
import { DateRange } from '../../core/models/date-range.model';
import { ReportResponse } from '../../core/models/report.model';
import { ReportsService } from '../../core/services/reports.service';
import { DateRangeFilterComponent } from '../../shared/components/date-range-filter/date-range-filter.component';

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

type ReportKey =
  | 'pickup'
  | 'forecastVariance'
  | 'marketPosition'
  | 'executiveSummary'
  | 'crsReconciliation'
  | 'recommendationCompliance'
  | 'revenueOpportunity';

interface ReportCatalogItem {
  key: ReportKey;
  label: string;
  description: string;
  icon: string;
}

interface TableView {
  id: string;
  title: string;
  columns: string[];
  rows: Record<string, unknown>[];
  emptyMessage: string;
}

interface SummaryItem {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'info';
}

interface ReportView {
  summary: SummaryItem[];
  primaryTable: TableView | null;
  secondaryTable: TableView | null;
  notes: string[];
}

interface QueryResult<T> {
  data: T | null;
  error: string | null;
}

const REPORT_CATALOG: ReportCatalogItem[] = [
  {
    key: 'pickup',
    label: 'Pickup',
    description: 'Reservas por fecha de booking y stay.',
    icon: 'insights'
  },
  {
    key: 'forecastVariance',
    label: 'Forecast Variance',
    description: 'Desviacion OTB contra baseline forecast.',
    icon: 'trending_up'
  },
  {
    key: 'marketPosition',
    label: 'Market Position',
    description: 'Gap de precio y ranking frente a competidores.',
    icon: 'query_stats'
  },
  {
    key: 'executiveSummary',
    label: 'Executive Summary',
    description: 'KPIs globales y highlights de riesgo/oportunidad.',
    icon: 'leaderboard'
  },
  {
    key: 'crsReconciliation',
    label: 'CRS vs RMS',
    description: 'Reconciliacion de totales y variaciones.',
    icon: 'compare_arrows'
  },
  {
    key: 'recommendationCompliance',
    label: 'Recommendation Compliance',
    description: 'Nivel de cumplimiento operativo de pricing.',
    icon: 'task_alt'
  },
  {
    key: 'revenueOpportunity',
    label: 'Revenue Opportunity',
    description: 'Upside y riesgo de sobreprecio.',
    icon: 'attach_money'
  }
];

@Component({
  selector: 'app-reports-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSnackBarModule,
    DateRangeFilterComponent
  ],
  templateUrl: './reports-page.component.html',
  styleUrl: './reports-page.component.scss'
})
export class ReportsPageComponent {
  readonly loading = signal(false);
  readonly dateRange = signal<DateRange>(defaultRange(60));
  readonly tolerancePct = signal(2);
  readonly whichDate = signal('Confirmation');

  readonly selectedReport = signal<ReportKey>('executiveSummary');
  readonly reportCatalog = REPORT_CATALOG;

  readonly reports = signal<Record<ReportKey, ReportResponse | null>>({
    pickup: null,
    forecastVariance: null,
    marketPosition: null,
    executiveSummary: null,
    crsReconciliation: null,
    recommendationCompliance: null,
    revenueOpportunity: null
  });

  readonly reportErrors = signal<Record<ReportKey, string | null>>({
    pickup: null,
    forecastVariance: null,
    marketPosition: null,
    executiveSummary: null,
    crsReconciliation: null,
    recommendationCompliance: null,
    revenueOpportunity: null
  });

  readonly selectedCatalogItem = computed(
    () => this.reportCatalog.find((item) => item.key === this.selectedReport()) ?? this.reportCatalog[0]
  );

  readonly selectedReportData = computed(() => this.reports()[this.selectedReport()]);
  readonly selectedReportError = computed(() => this.reportErrors()[this.selectedReport()]);
  readonly selectedReportView = computed(() =>
    this.buildReportView(this.selectedReport(), this.selectedReportData())
  );

  readonly reportCards = computed(() => {
    const reports = this.reports();
    const errors = this.reportErrors();

    return this.reportCatalog.map((item) => {
      const view = this.buildReportView(item.key, reports[item.key]);
      const rowCount = (view.primaryTable?.rows.length ?? 0) + (view.secondaryTable?.rows.length ?? 0);

      return {
        ...item,
        rowCount,
        hasData: Boolean(reports[item.key]),
        hasError: Boolean(errors[item.key])
      };
    });
  });

  constructor(
    private readonly reportsService: ReportsService,
    private readonly snackBar: MatSnackBar
  ) {
    this.loadReports(this.dateRange());
  }

  onDateRangeApply(dateRange: DateRange): void {
    this.loadReports(dateRange);
  }

  onRefreshClick(): void {
    this.loadReports(this.dateRange());
  }

  onSelectReport(reportKey: ReportKey): void {
    this.selectedReport.set(reportKey);
  }

  onToleranceChanged(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return;
    }

    this.tolerancePct.set(parsed);
  }

  onWhichDateChanged(value: string): void {
    this.whichDate.set(value);
  }

  onReloadParameterizedReports(): void {
    const range = this.dateRange();
    this.loading.set(true);

    forkJoin({
      recommendationCompliance: this.wrapQuery(
        this.reportsService.getRecommendationComplianceReport(range, this.tolerancePct()),
        'No fue posible recalcular recommendation compliance.'
      ),
      crsReconciliation: this.wrapQuery(
        this.reportsService.getCrsReconciliationReport(range, this.whichDate().trim()),
        'No fue posible recalcular reconciliacion CRS vs RMS.'
      )
    }).subscribe({
      next: ({ recommendationCompliance, crsReconciliation }) => {
        this.reports.update((state) => ({
          ...state,
          recommendationCompliance: recommendationCompliance.data,
          crsReconciliation: crsReconciliation.data
        }));

        this.reportErrors.update((state) => ({
          ...state,
          recommendationCompliance: recommendationCompliance.error,
          crsReconciliation: crsReconciliation.error
        }));

        this.loading.set(false);
        this.snackBar.open('Reportes parametricos actualizados.', 'Cerrar', { duration: 2200 });
      }
    });
  }

  onExportPrimaryCsv(): void {
    const table = this.selectedReportView().primaryTable;
    if (!table) {
      this.snackBar.open('El reporte activo no tiene tabla para exportar.', 'Cerrar', { duration: 2200 });
      return;
    }

    this.exportTableAsCsv(table, this.selectedReport());
  }

  onExportSecondaryCsv(): void {
    const table = this.selectedReportView().secondaryTable;
    if (!table) {
      this.snackBar.open('No hay una segunda tabla para exportar.', 'Cerrar', { duration: 2200 });
      return;
    }

    this.exportTableAsCsv(table, `${this.selectedReport()}-secondary`);
  }

  hasRows(table: TableView | null): boolean {
    return Boolean(table?.rows.length);
  }

  prettyColumn(column: string): string {
    return column
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  formatCell(column: string, value: unknown): string {
    if (value === null || value === undefined || value === '') {
      return '-';
    }

    if (typeof value === 'boolean') {
      return value ? 'Si' : 'No';
    }

    if (typeof value === 'number') {
      if (this.isPercentColumn(column)) {
        return `${this.numberFormatter.format(value)}%`;
      }

      if (this.isMoneyColumn(column)) {
        return this.currencyFormatter.format(value);
      }

      return this.numberFormatter.format(value);
    }

    if (Array.isArray(value)) {
      return value.join(' | ');
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }

  private readonly numberFormatter = new Intl.NumberFormat('es-MX', {
    maximumFractionDigits: 2
  });

  private readonly currencyFormatter = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 2
  });

  private loadReports(dateRange: DateRange): void {
    this.dateRange.set(dateRange);
    this.loading.set(true);

    forkJoin({
      pickup: this.wrapQuery(
        this.reportsService.getPickupReport(dateRange),
        'No fue posible cargar pickup.'
      ),
      forecastVariance: this.wrapQuery(
        this.reportsService.getForecastVarianceReport(dateRange),
        'No fue posible cargar forecast variance.'
      ),
      marketPosition: this.wrapQuery(
        this.reportsService.getMarketPositionReport(dateRange),
        'No fue posible cargar market position.'
      ),
      recommendationCompliance: this.wrapQuery(
        this.reportsService.getRecommendationComplianceReport(dateRange, this.tolerancePct()),
        'No fue posible cargar recommendation compliance.'
      ),
      revenueOpportunity: this.wrapQuery(
        this.reportsService.getRevenueOpportunityReport(dateRange),
        'No fue posible cargar revenue opportunity.'
      ),
      executiveSummary: this.wrapQuery(
        this.reportsService.getExecutiveSummaryReport(dateRange),
        'No fue posible cargar executive summary.'
      ),
      crsReconciliation: this.wrapQuery(
        this.reportsService.getCrsReconciliationReport(dateRange, this.whichDate().trim()),
        'No fue posible cargar reconciliacion CRS vs RMS.'
      )
    }).subscribe({
      next: (data) => {
        this.reports.set({
          pickup: data.pickup.data,
          forecastVariance: data.forecastVariance.data,
          marketPosition: data.marketPosition.data,
          recommendationCompliance: data.recommendationCompliance.data,
          revenueOpportunity: data.revenueOpportunity.data,
          executiveSummary: data.executiveSummary.data,
          crsReconciliation: data.crsReconciliation.data
        });

        this.reportErrors.set({
          pickup: data.pickup.error,
          forecastVariance: data.forecastVariance.error,
          marketPosition: data.marketPosition.error,
          recommendationCompliance: data.recommendationCompliance.error,
          revenueOpportunity: data.revenueOpportunity.error,
          executiveSummary: data.executiveSummary.error,
          crsReconciliation: data.crsReconciliation.error
        });

        this.loading.set(false);
      }
    });
  }

  private wrapQuery(source$: ReturnType<ReportsService['getPickupReport']>, errorMessage: string) {
    return source$.pipe(
      map((data) => ({ data, error: null }) as QueryResult<ReportResponse>),
      catchError(() => of({ data: null, error: errorMessage } as QueryResult<ReportResponse>))
    );
  }

  private buildReportView(reportKey: ReportKey, report: ReportResponse | null): ReportView {
    if (!report) {
      return {
        summary: [],
        primaryTable: null,
        secondaryTable: null,
        notes: ['No hay datos cargados para este reporte en el rango seleccionado.']
      };
    }

    const data = report as Record<string, unknown>;

    switch (reportKey) {
      case 'pickup':
        return {
          summary: [
            {
              label: 'Reservas consideradas',
              value: this.formatCell('reservations_count', this.record(data['summary'])['active_reservations_considered'])
            },
            {
              label: 'Rooms booked',
              value: this.formatCell('rooms_booked', this.record(data['summary'])['rooms_booked'])
            },
            {
              label: 'Revenue booked',
              value: this.formatCell('revenue_booked', this.record(data['summary'])['revenue_booked']),
              tone: 'info'
            }
          ],
          primaryTable: {
            id: 'pickup-booking',
            title: 'Pickup por fecha de booking',
            columns: [
              'booking_date',
              'reservations_count',
              'rooms_booked',
              'revenue_booked',
              'future_rooms_booked',
              'future_revenue_booked'
            ],
            rows: this.rows(data['daily_booking_pickup']),
            emptyMessage: 'No hay filas de booking pickup.'
          },
          secondaryTable: {
            id: 'pickup-stay',
            title: 'Pickup por fecha de stay',
            columns: [
              'stay_date',
              'reservations_count',
              'rooms_booked',
              'revenue_booked',
              'avg_room_rate',
              'first_booking_date',
              'last_booking_date'
            ],
            rows: this.rows(data['stay_date_pickup']),
            emptyMessage: 'No hay filas de stay pickup.'
          },
          notes: [
            `Booking window: ${this.record(data['booking_window'])['start'] ?? '-'} -> ${this.record(data['booking_window'])['end'] ?? '-'}`,
            `Stay window: ${this.record(data['stay_window'])['start'] ?? '-'} -> ${this.record(data['stay_window'])['end'] ?? '-'}`
          ]
        };

      case 'forecastVariance':
        return {
          summary: [
            {
              label: 'Above forecast days',
              value: this.formatCell(
                'days',
                this.record(data['summary'])['above_forecast_days']
              ),
              tone: 'ok'
            },
            {
              label: 'Below forecast days',
              value: this.formatCell(
                'days',
                this.record(data['summary'])['below_forecast_days']
              ),
              tone: 'warn'
            },
            {
              label: 'Revenue variance total',
              value: this.formatCell(
                'variance_revenue',
                this.record(data['summary'])['total_revenue_variance']
              ),
              tone: 'info'
            }
          ],
          primaryTable: {
            id: 'forecast-variance',
            title: 'Detalle diario de varianza',
            columns: [
              'date',
              'forecast_rooms',
              'otb_rooms',
              'variance_rooms',
              'variance_rooms_pct',
              'variance_revenue',
              'status'
            ],
            rows: this.rows(data['items']),
            emptyMessage: 'No hay filas para forecast variance.'
          },
          secondaryTable: null,
          notes: ['Comparacion OTB vs baseline almacenado en DailyMetrics.']
        };

      case 'marketPosition':
        return {
          summary: [
            {
              label: 'Underpriced days',
              value: this.formatCell('days', this.record(data['summary'])['underpriced_days']),
              tone: 'ok'
            },
            {
              label: 'Aligned days',
              value: this.formatCell('days', this.record(data['summary'])['aligned_days']),
              tone: 'info'
            },
            {
              label: 'Overpriced days',
              value: this.formatCell('days', this.record(data['summary'])['overpriced_days']),
              tone: 'warn'
            },
            {
              label: 'Avg price gap %',
              value: this.formatCell('price_gap_pct', this.record(data['summary'])['avg_price_gap_pct'])
            }
          ],
          primaryTable: {
            id: 'market-position',
            title: 'Posicion diaria frente al mercado',
            columns: [
              'date',
              'your_price',
              'market_average',
              'price_gap_pct',
              'position_rank',
              'position'
            ],
            rows: this.rows(data['items']),
            emptyMessage: 'No hay filas para market position.'
          },
          secondaryTable: null,
          notes: ['Posicion basada en desviacion de precio frente al promedio competitivo.']
        };

      case 'recommendationCompliance':
        return {
          summary: [
            {
              label: 'Total recomendaciones',
              value: this.formatCell('total', this.record(data['summary'])['total'])
            },
            {
              label: 'Compliant',
              value: this.formatCell('compliant', this.record(data['summary'])['compliant']),
              tone: 'ok'
            },
            {
              label: 'Non compliant',
              value: this.formatCell('non_compliant', this.record(data['summary'])['non_compliant']),
              tone: 'warn'
            },
            {
              label: 'Tolerance',
              value: this.formatCell('tolerance_pct', this.record(data['summary'])['tolerance_pct'])
            }
          ],
          primaryTable: {
            id: 'recommendation-compliance',
            title: 'Ejecucion de recomendaciones',
            columns: [
              'date',
              'action',
              'current_price',
              'suggested_price',
              'price_gap_pct',
              'booked_rooms',
              'compliance'
            ],
            rows: this.rows(data['items']),
            emptyMessage: 'No hay filas para compliance.'
          },
          secondaryTable: null,
          notes: ['La tolerancia se aplica sobre diferencia porcentual de precio.']
        };

      case 'revenueOpportunity':
        return {
          summary: [
            {
              label: 'Upside total',
              value: this.formatCell(
                'upside_potential',
                this.record(data['summary'])['total_upside_potential']
              ),
              tone: 'ok'
            },
            {
              label: 'Riesgo total',
              value: this.formatCell(
                'overpricing_risk',
                this.record(data['summary'])['total_overpricing_risk']
              ),
              tone: 'warn'
            },
            {
              label: 'Upside days',
              value: this.formatCell('upside_days', this.record(data['summary'])['upside_days'])
            },
            {
              label: 'Risk days',
              value: this.formatCell('risk_days', this.record(data['summary'])['risk_days'])
            }
          ],
          primaryTable: {
            id: 'revenue-opportunity',
            title: 'Detalle diario de oportunidad',
            columns: [
              'date',
              'action',
              'current_price',
              'suggested_price',
              'price_delta',
              'upside_potential',
              'overpricing_risk'
            ],
            rows: this.rows(data['items']),
            emptyMessage: 'No hay filas para revenue opportunity.'
          },
          secondaryTable: {
            id: 'revenue-upside-top',
            title: 'Top dias de upside',
            columns: ['date', 'action', 'price_delta', 'upside_potential'],
            rows: this.rows(data['top_upside_days']),
            emptyMessage: 'No hay dias con upside positivo.'
          },
          notes: ['Upside se calcula en acciones INCREASE; riesgo en acciones DECREASE.']
        };

      case 'executiveSummary':
        return {
          summary: [
            {
              label: 'Avg occupancy',
              value: this.formatCell('avg_occupancy', this.record(data['kpis'])['avg_occupancy'])
            },
            {
              label: 'Avg ADR',
              value: this.formatCell('avg_adr', this.record(data['kpis'])['avg_adr']),
              tone: 'info'
            },
            {
              label: 'Total revenue',
              value: this.formatCell('total_revenue', this.record(data['kpis'])['total_revenue']),
              tone: 'info'
            },
            {
              label: 'Alertas activas',
              value: this.formatCell('active_alerts', this.record(data['kpis'])['active_alerts']),
              tone: 'warn'
            }
          ],
          primaryTable: {
            id: 'executive-top-upside',
            title: 'Top dias de upside',
            columns: ['date', 'action', 'price_delta', 'upside_potential'],
            rows: this.rows(this.record(data['highlights'])['top_upside_days']),
            emptyMessage: 'No hay highlights de upside.'
          },
          secondaryTable: {
            id: 'executive-open-alerts',
            title: 'Alertas abiertas (top)',
            columns: ['date', 'severity', 'title', 'message'],
            rows: this.rows(this.record(data['highlights'])['open_alerts']),
            emptyMessage: 'No hay alertas abiertas en el rango.'
          },
          notes: ['Resumen consolidado de KPIs, alertas y potencial de ingresos.']
        };

      case 'crsReconciliation': {
        const variance = this.record(data['variance']);

        const rows: Record<string, unknown>[] = [
          {
            metric: 'Reservations',
            rms_actual: this.record(variance['reservations'])['actual'],
            crs_baseline: this.record(variance['reservations'])['baseline'],
            delta: this.record(variance['reservations'])['delta'],
            delta_pct: this.record(variance['reservations'])['deltaPct']
          },
          {
            metric: 'Room nights',
            rms_actual: this.record(variance['room_nights'])['actual'],
            crs_baseline: this.record(variance['room_nights'])['baseline'],
            delta: this.record(variance['room_nights'])['delta'],
            delta_pct: this.record(variance['room_nights'])['deltaPct']
          },
          {
            metric: 'Revenue',
            rms_actual: this.record(variance['revenue'])['actual'],
            crs_baseline: this.record(variance['revenue'])['baseline'],
            delta: this.record(variance['revenue'])['delta'],
            delta_pct: this.record(variance['revenue'])['deltaPct']
          },
          {
            metric: 'ADR',
            rms_actual: this.record(variance['adr'])['actual'],
            crs_baseline: this.record(variance['adr'])['baseline'],
            delta: this.record(variance['adr'])['delta'],
            delta_pct: this.record(variance['adr'])['deltaPct']
          }
        ];

        const mismatch = this.record(this.record(data['summary'])['mismatch_flags']);

        return {
          summary: [
            {
              label: 'Mismatch significativo',
              value: this.formatCell(
                'significant_mismatch',
                this.record(data['summary'])['significant_mismatch']
              ),
              tone: this.record(data['summary'])['significant_mismatch'] ? 'warn' : 'ok'
            },
            {
              label: 'CRS revenue',
              value: this.formatCell('revenue', this.record(this.record(data['totals'])['crs'])['revenue'])
            },
            {
              label: 'RMS revenue',
              value: this.formatCell('revenue', this.record(this.record(data['totals'])['rms'])['revenue'])
            },
            {
              label: 'Comparison basis',
              value: this.formatCell('basis', data['comparison_basis'])
            }
          ],
          primaryTable: {
            id: 'crs-reconciliation-variance',
            title: 'Varianza por metrica',
            columns: ['metric', 'rms_actual', 'crs_baseline', 'delta', 'delta_pct'],
            rows,
            emptyMessage: 'No hay filas de varianza.'
          },
          secondaryTable: {
            id: 'crs-reconciliation-flags',
            title: 'Flags de mismatch',
            columns: ['metric', 'is_mismatch'],
            rows: Object.entries(mismatch).map(([metric, isMismatch]) => ({
              metric,
              is_mismatch: isMismatch
            })),
            emptyMessage: 'No hay flags de mismatch.'
          },
          notes: [
            `Base CRS whichDate: ${this.record(data['assumptions'])['crs_which_date'] ?? '-'}`,
            `Rango: ${this.record(data['date_range'])['start'] ?? '-'} -> ${this.record(data['date_range'])['end'] ?? '-'}`
          ]
        };
      }

      default:
        return {
          summary: [],
          primaryTable: null,
          secondaryTable: null,
          notes: ['Reporte no soportado por la vista actual.']
        };
    }
  }

  private rows(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
    );
  }

  private record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  }

  private isPercentColumn(column: string): boolean {
    const key = column.toLowerCase();
    return key.includes('pct') || key.includes('occupancy');
  }

  private isMoneyColumn(column: string): boolean {
    const key = column.toLowerCase();
    if (key.includes('pct')) {
      return false;
    }

    return (
      key.includes('revenue') ||
      key.includes('price') ||
      key.includes('adr') ||
      key.includes('rate') ||
      key.includes('upside') ||
      key.includes('risk') ||
      key.includes('delta')
    );
  }

  private exportTableAsCsv(table: TableView, suffix: string): void {
    if (!table.rows.length) {
      this.snackBar.open('No hay filas para exportar.', 'Cerrar', { duration: 2200 });
      return;
    }

    const csv = this.buildCsv(table.columns, table.rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = `${suffix}_${this.dateRange().startDate}_${this.dateRange().endDate}.csv`;
    anchor.click();

    URL.revokeObjectURL(url);
    this.snackBar.open('CSV exportado correctamente.', 'Cerrar', { duration: 2200 });
  }

  private buildCsv(columns: string[], rows: Record<string, unknown>[]): string {
    const header = columns.join(',');

    const lines = rows.map((row) => {
      return columns
        .map((column) => {
          const raw = row[column];
          const value = raw === null || raw === undefined ? '' : String(raw);
          return `"${value.replace(/"/g, '""')}"`;
        })
        .join(',');
    });

    return [header, ...lines].join('\n');
  }
}
