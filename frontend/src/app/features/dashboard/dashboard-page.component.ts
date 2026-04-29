import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ChartConfiguration } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { forkJoin } from 'rxjs';
import { AlertItem } from '../../core/models/alert.model';
import { DateRange } from '../../core/models/date-range.model';
import { MetricItem } from '../../core/models/metric.model';
import { AlertsService } from '../../core/services/alerts.service';
import { MetricsService } from '../../core/services/metrics.service';
import { DateRangeFilterComponent } from '../../shared/components/date-range-filter/date-range-filter.component';
import { KpiCardComponent } from '../../shared/components/kpi-card/kpi-card.component';

function formatDateISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(daysBack: number): DateRange {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - daysBack);
  return {
    startDate: formatDateISO(startDate),
    endDate: formatDateISO(endDate)
  };
}

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
    BaseChartDirective,
    DateRangeFilterComponent,
    KpiCardComponent
  ],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.scss'
})
export class DashboardPageComponent {
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly dateRange = signal<DateRange>(defaultRange(29));
  readonly metrics = signal<MetricItem[]>([]);
  readonly alerts = signal<AlertItem[]>([]);

  readonly latestMetric = computed(() => {
    const items = this.metrics();
    return items.length ? items[items.length - 1] : null;
  });

  readonly avgOccupancy = computed(() => this.average(this.metrics().map((m) => m.occupancy)));
  readonly avgAdr = computed(() => this.average(this.metrics().map((m) => m.adr)));
  readonly avgRevpar = computed(() => this.average(this.metrics().map((m) => m.revpar)));
  readonly totalRevenue = computed(() => this.metrics().reduce((sum, item) => sum + item.revenue, 0));

  readonly statusToday = computed(() => {
    const metric = this.latestMetric();
    const activeAlerts = this.alerts().filter((item) => !item.resolved).length;

    if (!metric) {
      return {
        title: 'Sin datos recientes',
        message: 'Carga fuentes de datos para iniciar el ciclo de revenue.',
        actionLabel: 'Ir a ingesta',
        actionPath: '/upload',
        tone: 'info'
      };
    }

    if (activeAlerts > 0) {
      return {
        title: `Atencion inmediata: ${activeAlerts} alertas activas`,
        message: 'Prioriza resolucion de alertas y confirma ejecucion de precio en canal.',
        actionLabel: 'Ver alertas',
        actionPath: '/alerts',
        tone: 'warn'
      };
    }

    if (metric.occupancy >= 75) {
      return {
        title: 'Demanda alta detectada',
        message: 'Evalua incremento de tarifa y valida posicion competitiva.',
        actionLabel: 'Generar recomendaciones',
        actionPath: '/recommendations',
        tone: 'ok'
      };
    }

    return {
      title: 'Operacion estable',
      message: 'Monitorea pronostico vs OTB y conserva disciplina tarifaria.',
      actionLabel: 'Revisar reportes',
      actionPath: '/reports',
      tone: 'info'
    };
  });

  readonly topAlerts = computed(() => this.alerts().slice(0, 5));

  readonly chartData = computed<ChartConfiguration<'line'>['data']>(() => {
    const metrics = this.metrics();
    return {
      labels: metrics.map((item) => item.date),
      datasets: [
        {
          data: metrics.map((item) => item.occupancy),
          label: 'Ocupacion %',
          yAxisID: 'yOccupancy',
          borderColor: '#0d9488',
          backgroundColor: 'rgba(13, 148, 136, 0.18)',
          tension: 0.25,
          fill: true
        },
        {
          data: metrics.map((item) => item.adr),
          label: 'ADR',
          yAxisID: 'yMoney',
          borderColor: '#1d4ed8',
          backgroundColor: 'rgba(29, 78, 216, 0.13)',
          tension: 0.25
        },
        {
          data: metrics.map((item) => item.revpar),
          label: 'RevPAR',
          yAxisID: 'yMoney',
          borderColor: '#c2410c',
          backgroundColor: 'rgba(194, 65, 12, 0.13)',
          tension: 0.25
        }
      ]
    };
  });

  readonly chartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false
    },
    plugins: {
      legend: {
        position: 'bottom'
      }
    },
    scales: {
      yOccupancy: {
        type: 'linear',
        position: 'left',
        min: 0,
        max: 100,
        ticks: {
          callback: (value) => `${value}%`
        }
      },
      yMoney: {
        type: 'linear',
        position: 'right',
        grid: {
          drawOnChartArea: false
        }
      }
    }
  };

  readonly chartType = 'line' as const;

  constructor(
    private readonly metricsService: MetricsService,
    private readonly alertsService: AlertsService
  ) {
    this.refresh(this.dateRange());
  }

  onDateRangeApply(dateRange: DateRange): void {
    this.refresh(dateRange);
  }

  private refresh(dateRange: DateRange): void {
    this.dateRange.set(dateRange);
    this.loading.set(true);
    this.errorMessage.set(null);

    forkJoin({
      metrics: this.metricsService.getMetrics(dateRange),
      alerts: this.alertsService.getAlerts({ ...dateRange, resolved: false })
    }).subscribe({
      next: ({ metrics, alerts }) => {
        this.metrics.set(metrics.items);
        this.alerts.set(alerts.items);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('No se pudo cargar dashboard. Reintenta o valida conexion al backend.');
        this.loading.set(false);
      }
    });
  }

  private average(values: number[]): number {
    if (!values.length) {
      return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
}
