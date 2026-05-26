import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import { BiExecutiveSummaryResponse, RevenueCalendarItem } from '../../core/models/bi.model';
import { DateRange } from '../../core/models/date-range.model';
import { RateShopSummaryResponse } from '../../core/models/rate-shopping.model';
import { BiService } from '../../core/services/bi.service';
import { RateShoppingService } from '../../core/services/rate-shopping.service';
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
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
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
  readonly rateShopSummary = signal<RateShopSummaryResponse | null>(null);
  readonly calendar = signal<RevenueCalendarItem[]>([]);
  readonly selectedDate = signal<RevenueCalendarItem | null>(null);
  readonly lastUpdated = signal('');
  readonly rateShopLoading = signal(false);
  readonly rateShopRefreshing = signal(false);
  readonly marketCity = signal('Los Mochis');

  readonly topOpportunities = computed(() => this.summary()?.top_opportunities ?? []);
  readonly topRisks = computed(() => this.summary()?.top_risks ?? []);
  readonly topPickup = computed(() => this.summary()?.top_pickup ?? []);
  readonly publicRateWatch = computed(() => this.rateShopSummary()?.spotlight ?? null);
  readonly priorityActions = computed(() => {
    return [...this.topOpportunities(), ...this.topRisks()]
      .filter((row, index, rows) => rows.findIndex((item) => item.date === row.date) === index)
      .sort(
        (a, b) =>
          Math.max(b.opportunityScore, b.riskScore) - Math.max(a.opportunityScore, a.riskScore)
      )
      .slice(0, 5);
  });

  constructor(
    private readonly biService: BiService,
    private readonly rateShoppingService: RateShoppingService,
    private readonly snackBar: MatSnackBar
  ) {
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

  rateShopFreshnessLabel(): string {
    const value = this.rateShopSummary()?.lastScrapedAt;
    if (!value) {
      return 'Sin snapshot publico';
    }

    return new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  }

  onMarketCityChanged(value: string): void {
    this.marketCity.set(value);
  }

  onRefreshRateShop(): void {
    const range = this.dateRange();
    const city = this.marketCity().trim();
    if (!city) {
      this.snackBar.open('Indica la ciudad para correr el rate shopper.', 'Cerrar', {
        duration: 2600
      });
      return;
    }

    this.rateShopRefreshing.set(true);
    this.rateShoppingService
      .run({
        city,
        checkInDate: range.startDate,
        checkOutDate: this.nextDate(range.startDate),
        adults: 2,
        includeHotelSelf: true
      })
      .subscribe({
        next: () => {
          this.loadRateShopSummary(range, true);
          this.snackBar.open('Rate shop actualizado con tarifas publicas.', 'Cerrar', {
            duration: 2400
          });
        },
        error: () => {
          this.rateShopRefreshing.set(false);
          this.snackBar.open('No fue posible correr el rate shopper.', 'Cerrar', {
            duration: 2600
          });
        }
      });
  }

  private refresh(dateRange: DateRange): void {
    this.dateRange.set(dateRange);
    this.loading.set(true);
    this.errorMessage.set(null);
    this.rateShopLoading.set(true);

    forkJoin({
      summary: this.biService.getExecutiveSummary(dateRange),
      calendar: this.biService.getRevenueCalendar(dateRange),
      rateShopSummary: this.rateShoppingService.getSummary(dateRange, this.marketCity().trim())
    }).subscribe({
      next: ({ summary, calendar, rateShopSummary }) => {
        this.summary.set(summary);
        this.rateShopSummary.set(rateShopSummary);
        this.calendar.set(calendar.items);
        this.selectedDate.set(calendar.items[0] ?? null);
        this.lastUpdated.set(
          new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
        );
        this.loading.set(false);
        this.rateShopLoading.set(false);
      },
      error: () => {
        this.errorMessage.set('No fue posible cargar Revenue Command. Verifica backend y datos.');
        this.loading.set(false);
        this.rateShopLoading.set(false);
      }
    });
  }

  private loadRateShopSummary(dateRange: DateRange, afterRefresh = false): void {
    this.rateShopLoading.set(!afterRefresh);
    this.rateShoppingService.getSummary(dateRange, this.marketCity().trim()).subscribe({
      next: (summary) => {
        this.rateShopSummary.set(summary);
        this.rateShopLoading.set(false);
        this.rateShopRefreshing.set(false);
      },
      error: () => {
        this.rateShopLoading.set(false);
        this.rateShopRefreshing.set(false);
      }
    });
  }

  private nextDate(dateIso: string): string {
    const date = new Date(`${dateIso}T00:00:00`);
    date.setDate(date.getDate() + 1);
    return formatDateISO(date);
  }
}
