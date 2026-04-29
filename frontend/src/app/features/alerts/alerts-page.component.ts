import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { DateRange } from '../../core/models/date-range.model';
import { AlertItem } from '../../core/models/alert.model';
import { AlertsService } from '../../core/services/alerts.service';
import { DateRangeFilterComponent } from '../../shared/components/date-range-filter/date-range-filter.component';

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

type ResolvedFilter = 'all' | 'true' | 'false';
type SeverityFilter = 'all' | 'low' | 'medium' | 'high';

@Component({
  selector: 'app-alerts-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatTableModule,
    MatFormFieldModule,
    MatSelectModule,
    DateRangeFilterComponent
  ],
  templateUrl: './alerts-page.component.html',
  styleUrl: './alerts-page.component.scss'
})
export class AlertsPageComponent {
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly togglingAlertIds = signal<number[]>([]);
  readonly items = signal<AlertItem[]>([]);
  readonly dateRange = signal<DateRange>(defaultRange(29));

  readonly resolvedFilter = signal<ResolvedFilter>('all');
  readonly severityFilter = signal<SeverityFilter>('all');
  readonly searchTerm = signal('');

  readonly displayedColumns = ['date', 'severity', 'title', 'message', 'resolved', 'actions'];

  readonly visibleItems = computed(() => {
    return this.items().filter((item) => {
      if (this.severityFilter() !== 'all' && item.severity !== this.severityFilter()) {
        return false;
      }

      const search = this.searchTerm().trim().toLowerCase();
      if (search) {
        const haystack = `${item.title} ${item.message}`.toLowerCase();
        if (!haystack.includes(search)) {
          return false;
        }
      }

      return true;
    });
  });

  readonly summary = computed(() => {
    const source = this.items();
    return {
      total: source.length,
      active: source.filter((item) => !item.resolved).length,
      resolved: source.filter((item) => item.resolved).length,
      high: source.filter((item) => item.severity === 'high' && !item.resolved).length,
      medium: source.filter((item) => item.severity === 'medium' && !item.resolved).length,
      low: source.filter((item) => item.severity === 'low' && !item.resolved).length
    };
  });

  constructor(
    private readonly alertsService: AlertsService,
    private readonly snackBar: MatSnackBar
  ) {
    this.refresh();
  }

  onDateRangeApply(dateRange: DateRange): void {
    this.dateRange.set(dateRange);
    this.refresh();
  }

  onResolvedFilterChange(value: ResolvedFilter): void {
    this.resolvedFilter.set(value);
    this.refresh();
  }

  severityClass(severity: AlertItem['severity']): string {
    return `severity-${severity}`;
  }

  isToggling(alertId: number): boolean {
    return this.togglingAlertIds().includes(alertId);
  }

  onToggleResolved(alert: AlertItem): void {
    if (this.isToggling(alert.id)) {
      return;
    }

    this.togglingAlertIds.update((ids) => [...ids, alert.id]);

    const request$ = alert.resolved
      ? this.alertsService.activateAlert(alert.id)
      : this.alertsService.resolveAlert(alert.id);

    request$.subscribe({
      next: ({ item }) => {
        this.items.update((rows) => rows.map((row) => (row.id === item.id ? item : row)));
        this.togglingAlertIds.update((ids) => ids.filter((id) => id !== alert.id));
        this.snackBar.open(item.resolved ? 'Alerta resuelta.' : 'Alerta reactivada.', 'Cerrar', {
          duration: 2200
        });
      },
      error: () => {
        this.togglingAlertIds.update((ids) => ids.filter((id) => id !== alert.id));
      }
    });
  }

  private refresh(): void {
    let resolved: boolean | undefined;
    if (this.resolvedFilter() === 'true') {
      resolved = true;
    }
    if (this.resolvedFilter() === 'false') {
      resolved = false;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    this.alertsService
      .getAlerts({
        ...this.dateRange(),
        resolved
      })
      .subscribe({
        next: (response) => {
          this.items.set(response.items);
          this.loading.set(false);
        },
        error: () => {
          this.errorMessage.set('No fue posible obtener alertas. Verifica backend y rango.');
          this.loading.set(false);
        }
      });
  }
}
