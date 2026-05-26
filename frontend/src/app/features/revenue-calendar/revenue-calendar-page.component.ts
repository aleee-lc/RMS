import { CommonModule } from '@angular/common';
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
  readonly exporting = signal<'csv' | null>(null);
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
    this.onPrint();
  }

  onPrint(): void {
    this.printing.set(true);
    const printWindow = window.open('', '_blank', 'width=1280,height=900');
    if (!printWindow) {
      this.errorMessage.set('No fue posible abrir la vista de impresion del calendario.');
      this.printing.set(false);
      return;
    }

    printWindow.document.write(this.buildPrintableDocument());
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      this.printing.set(false);
    }, 250);
  }

  dayOfWeek(date: string): string {
    const parsed = new Date(`${date}T00:00:00`);
    return parsed.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '').toUpperCase();
  }

  freshnessLabel(): string {
    return this.lastUpdated() ? `Act. ${this.lastUpdated()}` : 'Sin actualizacion';
  }

  isExporting(type: 'csv'): boolean {
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

  private exportReport(type: 'csv'): void {
    this.exporting.set(type);
    this.errorMessage.set(null);

    const request = this.biService.exportCsv(this.dateRange());

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

  private downloadBlob(response: import('@angular/common/http').HttpResponse<Blob>, fallbackFilename: string): void {
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

  private buildPrintableDocument(): string {
    const range = this.dateRange();
    const generatedAt = new Date().toLocaleString('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
    const selected = this.selectedDate();
    const rows = this.calendar()
      .map(
        (row) => `
          <tr>
            <td><strong>${this.escapeHtml(row.date)}</strong></td>
            <td>${this.escapeHtml(this.dayOfWeek(row.date))}</td>
            <td>${row.daysToArrival}</td>
            <td>${this.escapeHtml(this.formatPct(row.occupancy))}</td>
            <td>${row.pickup.rooms7d}</td>
            <td>${this.escapeHtml(this.formatCurrency(row.adr))}</td>
            <td>${this.escapeHtml(this.formatCurrency(row.revenue))}</td>
            <td>${this.escapeHtml(this.formatCurrency(row.market.yourPrice))}</td>
            <td>${this.escapeHtml(this.formatCurrency(row.market.marketAverage))}</td>
            <td>${this.escapeHtml(this.formatPct(row.market.gapPct))}</td>
            <td>${this.escapeHtml(
              row.market.rank ? `${row.market.rank}/${row.market.rankTotal}` : '-'
            )}</td>
          </tr>
        `
      )
      .join('');

    const evidence = selected
      ? selected.recommendation.evidence
          .map((item) => `<li>${this.escapeHtml(item)}</li>`)
          .join('')
      : '';

    return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Revenue Calendar ${this.escapeHtml(range.startDate)} a ${this.escapeHtml(range.endDate)}</title>
    <style>
      :root {
        --ink: #0f2d3a;
        --muted: #5b6770;
        --line: #c9d1d6;
        --surface: #f5f7f8;
        --risk: #b42318;
      }
      * { box-sizing: border-box; }
      body {
        color: #111827;
        font-family: Arial, Helvetica, sans-serif;
        margin: 0;
        padding: 28px 32px 36px;
      }
      .header {
        align-items: end;
        border-bottom: 1px solid var(--line);
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(0, 1fr) 280px;
        padding-bottom: 18px;
      }
      .eyebrow {
        color: var(--muted);
        font-family: "Courier New", monospace;
        font-size: 11px;
        letter-spacing: 0.18em;
        margin-bottom: 10px;
        text-transform: uppercase;
      }
      h1 {
        color: var(--ink);
        font-size: 34px;
        line-height: 1;
        margin: 0;
      }
      .sub {
        color: var(--muted);
        font-size: 15px;
        line-height: 1.5;
        margin-top: 10px;
      }
      .meta {
        border: 1px solid var(--line);
        display: grid;
        gap: 8px;
        padding: 14px;
      }
      .meta strong {
        color: var(--ink);
        display: block;
        font-size: 14px;
        margin-top: 4px;
      }
      .layout {
        display: grid;
        gap: 0;
        grid-template-columns: minmax(0, 1.6fr) 320px;
        margin-top: 24px;
      }
      .table-panel, .side-panel {
        border: 1px solid var(--line);
      }
      .table-panel { border-right: 0; }
      .panel-title {
        border-bottom: 1px solid var(--line);
        color: var(--ink);
        font-size: 14px;
        font-weight: 700;
        padding: 14px 16px;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th, td {
        border-bottom: 1px solid var(--line);
        font-size: 12px;
        padding: 12px 10px;
        text-align: left;
        vertical-align: top;
      }
      th {
        color: var(--muted);
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      tbody tr:nth-child(odd) {
        background: var(--surface);
      }
      .side-panel {
        padding: 20px;
      }
      .date-title {
        color: var(--ink);
        font-size: 28px;
        line-height: 1.05;
        margin: 0;
      }
      .date-copy {
        color: var(--muted);
        font-size: 14px;
        margin-top: 8px;
      }
      .callout {
        background: #fff3f1;
        border: 1px solid #efc9c3;
        margin-top: 24px;
        padding: 16px;
      }
      .callout span, .metric span {
        color: var(--muted);
        display: block;
        font-family: "Courier New", monospace;
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .callout strong {
        color: var(--ink);
        display: block;
        font-size: 18px;
        margin-top: 8px;
      }
      .callout p {
        margin: 8px 0 0;
        line-height: 1.45;
      }
      .metrics {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-top: 18px;
      }
      .metric {
        background: var(--surface);
        border: 1px solid var(--line);
        padding: 12px;
      }
      .metric strong {
        color: var(--ink);
        display: block;
        font-size: 18px;
        margin-top: 6px;
      }
      .block {
        margin-top: 22px;
      }
      .block h2 {
        color: var(--ink);
        font-size: 15px;
        margin: 0 0 10px;
      }
      .block ul {
        margin: 0;
        padding-left: 18px;
      }
      .block li {
        line-height: 1.5;
        margin-bottom: 4px;
      }
      @media print {
        body { padding: 14px 18px 20px; }
      }
    </style>
  </head>
  <body>
    <header class="header">
      <div>
        <div class="eyebrow">Revenue Calendar</div>
        <h1>Revenue detail by date</h1>
        <p class="sub">Rango ${this.escapeHtml(range.startDate)} a ${this.escapeHtml(
          range.endDate
        )}. Generado ${this.escapeHtml(generatedAt)}.</p>
      </div>
      <div class="meta">
        <div>
          <span class="eyebrow" style="margin:0; font-size:10px;">Fecha destacada</span>
          <strong>${this.escapeHtml(selected?.date ?? 'Sin seleccion')}</strong>
        </div>
        <div>
          <span class="eyebrow" style="margin:0; font-size:10px;">Accion</span>
          <strong>${this.escapeHtml(selected?.recommendation.label ?? 'Sin accion')}</strong>
        </div>
      </div>
    </header>

    <section class="layout">
      <div class="table-panel">
        <div class="panel-title">Revenue detail by date</div>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>DOW</th>
              <th>DTA</th>
              <th>Occ</th>
              <th>PU 7d</th>
              <th>ADR</th>
              <th>Revenue</th>
              <th>Tarifa</th>
              <th>Comp set</th>
              <th>Gap</th>
              <th>Rank</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <aside class="side-panel">
        <div class="eyebrow">Date Intelligence</div>
        <h2 class="date-title">${this.escapeHtml(selected?.date ?? 'Sin seleccion')}</h2>
        <p class="date-copy">${this.escapeHtml(selected ? this.dayOfWeek(selected.date) : '-')}</p>

        <div class="callout">
          <span>Accion sugerida</span>
          <strong>${this.escapeHtml(selected?.recommendation.label ?? 'Sin accion')}</strong>
          <p>${this.escapeHtml(selected?.recommendation.reason ?? 'Sin detalle')}</p>
        </div>

        <div class="metrics">
          <div class="metric"><span>Ocupacion</span><strong>${this.escapeHtml(
            this.formatPct(selected?.occupancy ?? null)
          )}</strong></div>
          <div class="metric"><span>Pickup 7d</span><strong>${selected?.pickup.rooms7d ?? '-'}</strong></div>
          <div class="metric"><span>Tu tarifa</span><strong>${this.escapeHtml(
            this.formatCurrency(selected?.market.yourPrice ?? null)
          )}</strong></div>
          <div class="metric"><span>Comp set</span><strong>${this.escapeHtml(
            this.formatCurrency(selected?.market.marketAverage ?? null)
          )}</strong></div>
          <div class="metric"><span>Revenue</span><strong>${this.escapeHtml(
            this.formatCurrency(selected?.revenue ?? null)
          )}</strong></div>
          <div class="metric"><span>Impacto est.</span><strong>${this.escapeHtml(
            this.formatCurrency(selected?.recommendation.estimatedImpact ?? null)
          )}</strong></div>
        </div>

        <section class="block">
          <h2>Evidencia</h2>
          <ul>${evidence || '<li>Sin evidencia disponible</li>'}</ul>
        </section>
      </aside>
    </section>
  </body>
</html>`;
  }

  private formatCurrency(value: number | null): string {
    if (value === null) {
      return '-';
    }

    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 0
    }).format(value);
  }

  private formatPct(value: number | null): string {
    if (value === null) {
      return '-';
    }

    return `${value.toFixed(1)}%`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
