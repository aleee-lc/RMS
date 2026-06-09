import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { finalize } from 'rxjs';
import {
  RatePlanDetail,
  RatePlanImportResult,
  RatePlanInsight,
  RatePlanListItem
} from '../../core/models/rate-plan.model';
import { AuthService } from '../../core/services/auth.service';
import { RatePlansService } from '../../core/services/rate-plans.service';

@Component({
  selector: 'app-rate-plan-governance-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSnackBarModule
  ],
  templateUrl: './rate-plan-governance-page.component.html',
  styleUrl: './rate-plan-governance-page.component.scss'
})
export class RatePlanGovernancePageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly ratePlansService = inject(RatePlansService);
  private readonly snackBar = inject(MatSnackBar);

  readonly selectedHotelId = this.auth.selectedHotelId;
  readonly selectedFile = signal<File | null>(null);
  readonly importing = signal(false);
  readonly loadingCatalog = signal(false);
  readonly loadingInsights = signal(false);
  readonly loadingDetail = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly importResult = signal<RatePlanImportResult | null>(null);
  readonly ratePlans = signal<RatePlanListItem[]>([]);
  readonly insights = signal<RatePlanInsight[]>([]);
  readonly selectedRatePlan = signal<RatePlanDetail | null>(null);
  readonly selectedRatePlanId = signal<number | null>(null);
  readonly latestSummary = signal<{
    totalRatePlans: number;
    derivedRatePlans: number;
    insightCount: number;
    latestImportAt: string | null;
    latestImportFile: string | null;
  } | null>(null);
  readonly topMarketSegments = signal<Array<{ label: string; count: number }>>([]);
  readonly topPricingStandards = signal<Array<{ label: string; count: number }>>([]);

  readonly filterForm = this.fb.nonNullable.group({
    search: [''],
    marketSegment: [''],
    pricingStandard: [''],
    derivedOnly: [false]
  });

  readonly stats = computed(() => {
    const summary = this.latestSummary();
    return [
      {
        label: 'Rate plans',
        value: summary?.totalRatePlans ?? this.ratePlans().length,
        icon: 'inventory_2'
      },
      {
        label: 'Derivados',
        value: summary?.derivedRatePlans ?? this.ratePlans().filter((item) => item.derivedFromCode).length,
        icon: 'schema'
      },
      {
        label: 'Hallazgos',
        value: summary?.insightCount ?? this.insights().length,
        icon: 'warning'
      }
    ];
  });

  readonly canImport = computed(() => /\.(xlsx|xls)$/i.test(this.selectedFile()?.name ?? ''));
  readonly visibleInsights = computed(() => this.insights().slice(0, 10));

  constructor() {
    this.reload();
  }

  reload(): void {
    const hotelId = this.selectedHotelId();
    if (!hotelId) {
      this.errorMessage.set('Selecciona un hotel para trabajar con el rate plan master.');
      return;
    }

    this.loadCatalog(hotelId);
    this.loadInsights(hotelId);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.selectedFile.set(file);
    this.errorMessage.set(null);
    input.value = '';
  }

  onImport(): void {
    const hotelId = this.selectedHotelId();
    const file = this.selectedFile();

    if (!hotelId || !file || !this.canImport()) {
      return;
    }

    this.importing.set(true);
    this.errorMessage.set(null);

    this.ratePlansService
      .importMaster(hotelId, file)
      .pipe(finalize(() => this.importing.set(false)))
      .subscribe({
        next: (result) => {
          this.importResult.set(result);
          this.selectedFile.set(null);
          this.snackBar.open('Rate plan master importado correctamente.', 'Cerrar', {
            duration: 2600
          });
          this.reload();
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(this.resolveApiError(error));
        }
      });
  }

  onApplyFilters(): void {
    const hotelId = this.selectedHotelId();
    if (!hotelId) {
      return;
    }

    this.loadCatalog(hotelId);
  }

  onSelectRatePlan(item: RatePlanListItem): void {
    const hotelId = this.selectedHotelId();
    if (!hotelId) {
      return;
    }

    this.selectedRatePlanId.set(item.id);
    this.loadingDetail.set(true);

    this.ratePlansService
      .getRatePlan(hotelId, item.id)
      .pipe(finalize(() => this.loadingDetail.set(false)))
      .subscribe({
        next: (detail) => {
          this.selectedRatePlan.set(detail);
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(this.resolveApiError(error));
        }
      });
  }

  severityLabel(severity: RatePlanInsight['severity']): string {
    return severity === 'high' ? 'Alta' : severity === 'medium' ? 'Media' : 'Baja';
  }

  booleanLabel(value: boolean | null): string {
    return value === null ? 'N/D' : value ? 'Si' : 'No';
  }

  private loadCatalog(hotelId: number): void {
    this.loadingCatalog.set(true);

    const filters = this.filterForm.getRawValue();
    this.ratePlansService
      .listRatePlans(hotelId, {
        search: filters.search.trim(),
        marketSegment: filters.marketSegment.trim(),
        pricingStandard: filters.pricingStandard.trim(),
        derivedOnly: filters.derivedOnly,
        limit: 300
      })
      .pipe(finalize(() => this.loadingCatalog.set(false)))
      .subscribe({
        next: ({ items }) => {
          this.ratePlans.set(items);

          const selectedId = this.selectedRatePlanId();
          if (selectedId && items.some((item) => item.id === selectedId)) {
            const selected = items.find((item) => item.id === selectedId);
            if (selected) {
              this.onSelectRatePlan(selected);
            }
          } else {
            this.selectedRatePlanId.set(items[0]?.id ?? null);
            this.selectedRatePlan.set(null);
            if (items[0]) {
              this.onSelectRatePlan(items[0]);
            }
          }
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(this.resolveApiError(error));
        }
      });
  }

  private loadInsights(hotelId: number): void {
    this.loadingInsights.set(true);

    this.ratePlansService
      .getInsights(hotelId)
      .pipe(finalize(() => this.loadingInsights.set(false)))
      .subscribe({
        next: (response) => {
          this.latestSummary.set(response.summary);
          this.topMarketSegments.set(response.topMarketSegments);
          this.topPricingStandards.set(response.topPricingStandards);
          this.insights.set(response.items);
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(this.resolveApiError(error));
        }
      });
  }

  private resolveApiError(error: HttpErrorResponse): string {
    const payload = error.error as { message?: string | string[] } | null;

    if (Array.isArray(payload?.message) && payload.message.length > 0) {
      return payload.message.join(' | ');
    }

    if (typeof payload?.message === 'string' && payload.message.trim().length > 0) {
      return payload.message;
    }

    return 'No fue posible completar la operacion del modulo de rate plans.';
  }
}
