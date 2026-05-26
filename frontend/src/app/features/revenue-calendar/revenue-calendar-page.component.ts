import { CommonModule } from '@angular/common';
import { HttpResponse } from '@angular/common/http';
import { Component, computed, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { RevenueCalendarItem } from '../../core/models/bi.model';
import { DateRange } from '../../core/models/date-range.model';
import { BiService } from '../../core/services/bi.service';
import { DateRangeFilterComponent } from '../../shared/components/date-range-filter/date-range-filter.component';
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
  selector: 'app-revenue-calendar-page',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
    MatTableModule,
    DateRangeFilterComponent,
    MarketPositionCellComponent,
    ScoreBarComponent,
    SignalBadgeComponent
  ],
  templateUrl: './revenue-calendar-page.component.html',
  styleUrl: './revenue-calendar-page.component.scss'
})
export class RevenueCalendarPageComponent {
  readonly loading = signal(false);
  readonly exporting = signal<'csv' | 'pdf' | null>(null);
  readonly printing = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly dateRange = signal<DateRange>(defaultRange(29));
  readonly calendar = signal<RevenueCalendarItem[]>([]);
  readonly selectedDate = signal<RevenueCalendarItem | null>(null);
  readonly lastUpdated = signal('');

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
    'rank'
  ];

  readonly pageTitle = computed(() => {
    const selected = this.selectedDate();
    if (!selected) {
      return 'Selecciona una fecha del calendario';
    }

    return `${selected.date} ${this.dayOfWeek(selected.date)}`;
  });

  constructor(private readonly biService: BiService) {
    this.refresh(this.dateRange());
  }

  onDateRangeApply(dateRange: DateRange): void {
    this.refresh(dateRange);
  }

  onApplyQuickRange(days: number): void {
    this.refresh(defaultRange(days));
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

  onPrint(): void {
    this.printing.set(true);
    window.print();
    setTimeout(() => this.printing.set(false), 300);
  }

  dayOfWeek(date: string): string {
    const parsed = new Date(`${date}T00:00:00`);
    return parsed.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '').toUpperCase();
  }

  freshnessLabel(): string {
    return this.lastUpdated() ? `Act. ${this.lastUpdated()}` : 'Sin actualizacion';
  }

  isExporting(type: 'csv' | 'pdf'): boolean {
    return this.exporting() === type;
  }

  private refresh(dateRange: DateRange): void {
    this.dateRange.set(dateRange);
    this.loading.set(true);
    this.errorMessage.set(null);

    this.biService.getRevenueCalendar(dateRange).subscribe({
      next: (calendar) => {
        this.calendar.set(calendar.items);
        this.selectedDate.set(calendar.items[0] ?? null);
        this.lastUpdated.set(
          new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
        );
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('No fue posible cargar Revenue Calendar. Verifica backend y datos.');
        this.loading.set(false);
      }
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
          `No fue posible exportar Revenue Calendar a ${type.toUpperCase()}.`
        );
        this.exporting.set(null);
      }
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
    const match = disposition?.match(/filename=\"?([^\"]+)\"?/i);
    return match?.[1] ?? null;
  }

  private fallbackFilename(type: 'csv' | 'pdf'): string {
    const range = this.dateRange();
    return `revenue-calendar-${range.startDate}_a_${range.endDate}.${type}`;
  }
}
