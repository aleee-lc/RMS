import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
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
    MatCardModule,
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
  readonly dateRange = signal<DateRange>(defaultRange(29));
  readonly metrics = signal<MetricItem[]>([]);
  readonly alerts = signal<AlertItem[]>([]);

  readonly avgOccupancy = computed(() => this.average(this.metrics().map((m) => m.occupancy)));
  readonly avgAdr = computed(() => this.average(this.metrics().map((m) => m.adr)));
  readonly totalRevenue = computed(() => this.metrics().reduce((sum, item) => sum + item.revenue, 0));

  readonly chartData = computed<ChartConfiguration<'line'>['data']>(() => {
    const metrics = this.metrics();
    return {
      labels: metrics.map((item) => item.date),
      datasets: [
        {
          data: metrics.map((item) => item.occupancy),
          label: 'Ocupación %',
          yAxisID: 'yOccupancy',
          borderColor: '#0284c7',
          backgroundColor: 'rgba(2, 132, 199, 0.18)',
          tension: 0.25,
          fill: true
        },
        {
          data: metrics.map((item) => item.adr),
          label: 'ADR',
          yAxisID: 'yMoney',
          borderColor: '#7c3aed',
          backgroundColor: 'rgba(124, 58, 237, 0.15)',
          tension: 0.25
        },
        {
          data: metrics.map((item) => item.revenue),
          label: 'Revenue',
          yAxisID: 'yMoney',
          borderColor: '#15803d',
          backgroundColor: 'rgba(21, 128, 61, 0.15)',
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
