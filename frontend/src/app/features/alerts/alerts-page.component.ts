import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
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

@Component({
  selector: 'app-alerts-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatProgressBarModule,
    MatTableModule,
    MatFormFieldModule,
    MatSelectModule,
    DateRangeFilterComponent
  ],
  templateUrl: './alerts-page.component.html',
  styleUrl: './alerts-page.component.scss'
})
export class AlertsPageComponent {
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(false);
  readonly items = signal<AlertItem[]>([]);
  readonly dateRange = signal<DateRange>(defaultRange(29));

  readonly displayedColumns = ['date', 'severity', 'title', 'message', 'resolved'];

  readonly filterForm = this.fb.nonNullable.group({
    resolved: 'all'
  });

  constructor(private readonly alertsService: AlertsService) {
    this.refresh();

    this.filterForm.controls.resolved.valueChanges.subscribe(() => {
      this.refresh();
    });
  }

  onDateRangeApply(dateRange: DateRange): void {
    this.dateRange.set(dateRange);
    this.refresh();
  }

  severityClass(severity: AlertItem['severity']): string {
    return `severity-${severity}`;
  }

  private refresh(): void {
    const resolvedSelection = this.filterForm.controls.resolved.value;

    let resolved: boolean | undefined;
    if (resolvedSelection === 'true') {
      resolved = true;
    }
    if (resolvedSelection === 'false') {
      resolved = false;
    }

    this.loading.set(true);

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
          this.loading.set(false);
        }
      });
  }
}
