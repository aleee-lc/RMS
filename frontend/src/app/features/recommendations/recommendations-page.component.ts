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
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { DateRange } from '../../core/models/date-range.model';
import {
  DEFAULT_RECOMMENDATION_GENERATION_OPTIONS,
  RecommendationAction,
  RecommendationGenerationOptions,
  RecommendationItem
} from '../../core/models/recommendation.model';
import { RecommendationsService } from '../../core/services/recommendations.service';
import { DateRangeFilterComponent } from '../../shared/components/date-range-filter/date-range-filter.component';
import { ActionBadgeComponent } from '../../shared/components/action-badge/action-badge.component';

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

type MarketFilter = 'all' | 'under_market' | 'over_market' | 'near_market';

@Component({
  selector: 'app-recommendations-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatTableModule,
    DateRangeFilterComponent,
    ActionBadgeComponent
  ],
  templateUrl: './recommendations-page.component.html',
  styleUrl: './recommendations-page.component.scss'
})
export class RecommendationsPageComponent {
  readonly loading = signal(false);
  readonly generating = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly items = signal<RecommendationItem[]>([]);
  readonly dateRange = signal<DateRange>(defaultRange(13));
  readonly hotelRooms = signal(0);

  readonly actionFilter = signal<'all' | RecommendationAction>('all');
  readonly marketFilter = signal<MarketFilter>('all');
  readonly minOccupancyFilter = signal<number>(0);
  readonly generationOptions = signal<RecommendationGenerationOptions>({
    ...DEFAULT_RECOMMENDATION_GENERATION_OPTIONS
  });

  readonly generationConfigError = computed(() => {
    const options = this.generationOptions();
    if (options.lowOccupancyThreshold >= options.highOccupancyThreshold) {
      return 'La ocupacion baja debe ser menor que la ocupacion alta.';
    }
    if (options.minActionStepPct > options.maxAdjustmentPct) {
      return 'El paso minimo no puede ser mayor que el ajuste maximo.';
    }
    return null;
  });

  readonly displayedColumns = [
    'date',
    'action',
    'current_price',
    'suggested_price',
    'delta',
    'delta_pct',
    'estimated_impact',
    'occupancy',
    'market_position'
  ];

  readonly actionSummary = computed(() => {
    const source = this.items();
    return {
      total: source.length,
      increase: source.filter((item) => item.action === 'increase').length,
      decrease: source.filter((item) => item.action === 'decrease').length,
      hold: source.filter((item) => item.action === 'hold').length
    };
  });

  readonly enrichedItems = computed(() => {
    const rooms = Math.max(1, this.hotelRooms());

    return this.items().map((item) => {
      const current = item.your_price;
      const suggested = item.suggested_price;
      const delta = suggested - current;
      const deltaPct = current > 0 ? (delta / current) * 100 : 0;
      const estimatedRooms = Math.round((item.occupancy / 100) * rooms);
      const estimatedImpact = delta * estimatedRooms;

      const marketPosition: MarketFilter =
        item.your_price < item.market_average
          ? 'under_market'
          : item.your_price > item.market_average
            ? 'over_market'
            : 'near_market';

      return {
        ...item,
        delta,
        deltaPct,
        estimatedRooms,
        estimatedImpact,
        marketPosition
      };
    });
  });

  readonly filteredItems = computed(() => {
    return this.enrichedItems().filter((item) => {
      if (this.actionFilter() !== 'all' && item.action !== this.actionFilter()) {
        return false;
      }

      if (item.occupancy < this.minOccupancyFilter()) {
        return false;
      }

      if (this.marketFilter() !== 'all' && item.marketPosition !== this.marketFilter()) {
        return false;
      }

      return true;
    });
  });

  constructor(
    private readonly recommendationsService: RecommendationsService,
    private readonly snackBar: MatSnackBar
  ) {
    this.refresh(this.dateRange());
  }

  onDateRangeApply(dateRange: DateRange): void {
    this.refresh(dateRange);
  }

  onRefreshClick(): void {
    this.refresh(this.dateRange());
  }

  onGenerateClick(): void {
    if (this.generationConfigError()) {
      this.errorMessage.set(this.generationConfigError());
      return;
    }

    this.generating.set(true);
    this.errorMessage.set(null);

    this.recommendationsService
      .generateRecommendations(this.dateRange(), this.generationOptions())
      .subscribe({
      next: (response) => {
        this.items.set(response.items);
        this.hotelRooms.set(response.hotel.totalRooms);
        this.generating.set(false);
        this.snackBar.open('Recomendaciones generadas y persistidas.', 'Cerrar', { duration: 2500 });
      },
      error: () => {
        this.errorMessage.set('No se pudo generar recomendaciones. Revisa metricas y mercado cargado.');
        this.generating.set(false);
      }
    });
  }

  onGenerationOptionChange<K extends keyof RecommendationGenerationOptions>(
    key: K,
    value: number
  ): void {
    if (!Number.isFinite(value)) {
      return;
    }

    this.generationOptions.update((current) => ({
      ...current,
      [key]: value
    }));
  }

  onResetGenerationOptions(): void {
    this.generationOptions.set({
      ...DEFAULT_RECOMMENDATION_GENERATION_OPTIONS
    });
  }

  marketPositionLabel(value: MarketFilter): string {
    switch (value) {
      case 'under_market':
        return 'Bajo mercado';
      case 'over_market':
        return 'Sobre mercado';
      case 'near_market':
        return 'Alineado';
      default:
        return 'Todos';
    }
  }

  private refresh(dateRange: DateRange): void {
    this.dateRange.set(dateRange);
    this.loading.set(true);
    this.errorMessage.set(null);

    this.recommendationsService.getRecommendations(dateRange).subscribe({
      next: (response) => {
        this.items.set(response.items);
        this.hotelRooms.set(response.hotel.totalRooms);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('No se pudo consultar recomendaciones persistidas.');
        this.loading.set(false);
      }
    });
  }
}
