import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CompetitorItem } from '../../core/models/competitor.model';
import {
  DEFAULT_RECOMMENDATION_SETTINGS,
  HotelConfig,
  RecommendationSettings
} from '../../core/models/hotel.model';
import { CompetitorsService } from '../../core/services/competitors.service';
import { HotelsService } from '../../core/services/hotels.service';

@Component({
  selector: 'app-configuration-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatTooltipModule
  ],
  templateUrl: './configuration-page.component.html',
  styleUrl: './configuration-page.component.scss'
})
export class ConfigurationPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);

  readonly loadingHotels = signal(false);
  readonly loadingCompetitors = signal(false);
  readonly loadingRecommendationSettings = signal(false);
  readonly saving = signal(false);

  readonly hotelsError = signal<string | null>(null);
  readonly competitorsError = signal<string | null>(null);

  readonly hotels = signal<HotelConfig[]>([]);
  readonly competitors = signal<CompetitorItem[]>([]);
  readonly selectedHotelId = signal<number | null>(null);
  readonly competitorDrafts = signal<Record<number, string>>({});
  readonly recommendationSettingsSource = signal<'default' | 'custom'>('default');

  readonly selectedHotel = computed(() =>
    this.hotels().find((hotel) => hotel.id === this.selectedHotelId()) ?? null
  );

  readonly stats = computed(() => ({
    hotels: this.hotels().length,
    competitors: this.competitors().length,
    selectedHotel: this.selectedHotel()?.name ?? 'Sin seleccion'
  }));

  readonly createHotelForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(12)]],
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    totalRooms: [100, [Validators.required, Validators.min(1), Validators.max(20000)]],
    currency: ['MXN', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]],
    timezone: ['America/Chihuahua', [Validators.required, Validators.minLength(3), Validators.maxLength(80)]]
  });

  readonly updateHotelForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(12)]],
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    totalRooms: [0, [Validators.required, Validators.min(1), Validators.max(20000)]],
    currency: ['MXN', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]],
    timezone: ['America/Chihuahua', [Validators.required, Validators.minLength(3), Validators.maxLength(80)]]
  });

  readonly createCompetitorForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]]
  });

  readonly recommendationSettingsForm = this.fb.nonNullable.group({
    highOccupancyThreshold: [
      DEFAULT_RECOMMENDATION_SETTINGS.highOccupancyThreshold,
      [Validators.required, Validators.min(0), Validators.max(100)]
    ],
    lowOccupancyThreshold: [
      DEFAULT_RECOMMENDATION_SETTINGS.lowOccupancyThreshold,
      [Validators.required, Validators.min(0), Validators.max(100)]
    ],
    significantDiffPct: [
      DEFAULT_RECOMMENDATION_SETTINGS.significantDiffPct,
      [Validators.required, Validators.min(0), Validators.max(100)]
    ],
    demandWeight: [
      DEFAULT_RECOMMENDATION_SETTINGS.demandWeight,
      [Validators.required, Validators.min(0), Validators.max(2)]
    ],
    marketWeight: [
      DEFAULT_RECOMMENDATION_SETTINGS.marketWeight,
      [Validators.required, Validators.min(0), Validators.max(2)]
    ],
    maxAdjustmentPct: [
      DEFAULT_RECOMMENDATION_SETTINGS.maxAdjustmentPct,
      [Validators.required, Validators.min(1), Validators.max(40)]
    ],
    minActionStepPct: [
      DEFAULT_RECOMMENDATION_SETTINGS.minActionStepPct,
      [Validators.required, Validators.min(0.5), Validators.max(20)]
    ]
  });

  readonly recommendationSettingsError = computed(() => {
    const values = this.recommendationSettingsForm.getRawValue();
    if (values.lowOccupancyThreshold >= values.highOccupancyThreshold) {
      return 'La ocupacion baja debe ser menor que la ocupacion alta.';
    }
    if (values.minActionStepPct > values.maxAdjustmentPct) {
      return 'El paso minimo no puede ser mayor al ajuste maximo.';
    }
    return null;
  });

  readonly recommendationSettingHelp: Record<keyof RecommendationSettings, string> = {
    highOccupancyThreshold:
      'Por arriba de este porcentaje se considera demanda alta para evaluar incrementos de precio.',
    lowOccupancyThreshold:
      'Por debajo de este porcentaje se considera demanda baja para evaluar reducciones de precio.',
    significantDiffPct:
      'Brecha minima (%) contra el mercado para considerar que el precio esta fuera de posicion.',
    demandWeight:
      'Peso de la senal de demanda (ocupacion) en el calculo del precio sugerido.',
    marketWeight:
      'Peso de la posicion de mercado (tu precio vs comp set) en el calculo del precio sugerido.',
    maxAdjustmentPct:
      'Tope de ajuste permitido (%) por recomendacion para evitar cambios extremos en una sola accion.',
    minActionStepPct:
      'Cambio minimo (%) cuando la accion final es INCREASE o DECREASE.'
  };

  constructor(
    private readonly hotelsService: HotelsService,
    private readonly competitorsService: CompetitorsService
  ) {
    this.loadHotels();
  }

  onHotelSelectionChange(hotelIdValue: number | string): void {
    const hotelId = Number(hotelIdValue);
    if (!Number.isFinite(hotelId)) {
      return;
    }

    this.selectedHotelId.set(hotelId);
    this.loadHotelDetail(hotelId);
    this.loadCompetitors(hotelId);
    this.loadRecommendationSettings(hotelId);
  }

  onCreateHotel(): void {
    if (this.createHotelForm.invalid) {
      this.createHotelForm.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.hotelsService.createHotel(this.createHotelForm.getRawValue()).subscribe({
      next: ({ item }) => {
        this.saving.set(false);
        this.createHotelForm.setValue({
          code: '',
          name: '',
          totalRooms: 100,
          currency: item.currency,
          timezone: item.timezone
        });
        this.snackBar.open(`Hotel creado: ${item.name}`, 'Cerrar', { duration: 2500 });
        this.loadHotels(item.id);
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('No fue posible crear el hotel.', 'Cerrar', { duration: 2500 });
      }
    });
  }

  onUpdateSelectedHotel(): void {
    const hotelId = this.selectedHotelId();
    if (!hotelId) {
      return;
    }

    if (this.updateHotelForm.invalid) {
      this.updateHotelForm.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.hotelsService.updateHotel(hotelId, this.updateHotelForm.getRawValue()).subscribe({
      next: ({ item }) => {
        this.saving.set(false);
        this.snackBar.open(`Hotel actualizado: ${item.name}`, 'Cerrar', { duration: 2500 });
        this.loadHotels(item.id);
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('No fue posible actualizar el hotel.', 'Cerrar', { duration: 2500 });
      }
    });
  }

  onCreateCompetitor(): void {
    const hotelId = this.selectedHotelId();
    if (!hotelId) {
      return;
    }

    if (this.createCompetitorForm.invalid) {
      this.createCompetitorForm.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.competitorsService
      .createCompetitor(hotelId, this.createCompetitorForm.controls.name.value.trim())
      .subscribe({
        next: ({ item }) => {
          this.saving.set(false);
          this.createCompetitorForm.setValue({ name: '' });
          this.snackBar.open(`Competidor creado: ${item.name}`, 'Cerrar', { duration: 2500 });
          this.loadCompetitors(hotelId);
        },
        error: () => {
          this.saving.set(false);
          this.snackBar.open('No fue posible crear el competidor.', 'Cerrar', { duration: 2500 });
        }
      });
  }

  onCompetitorDraftChange(competitorId: number, value: string): void {
    this.competitorDrafts.update((drafts) => ({
      ...drafts,
      [competitorId]: value
    }));
  }

  canSaveCompetitor(competitor: CompetitorItem): boolean {
    const draft = this.competitorDrafts()[competitor.id]?.trim() ?? '';
    return draft.length >= 2 && draft !== competitor.name && !this.saving();
  }

  onSaveCompetitor(competitor: CompetitorItem): void {
    const nextName = this.competitorDrafts()[competitor.id]?.trim();
    if (!nextName || nextName === competitor.name) {
      return;
    }

    this.saving.set(true);
    this.competitorsService.updateCompetitor(competitor.id, nextName).subscribe({
      next: ({ item }) => {
        this.saving.set(false);
        this.snackBar.open(`Competidor actualizado: ${item.name}`, 'Cerrar', { duration: 2500 });
        const hotelId = this.selectedHotelId();
        if (hotelId) {
          this.loadCompetitors(hotelId);
        }
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('No fue posible actualizar el competidor.', 'Cerrar', { duration: 2500 });
      }
    });
  }

  onDeleteCompetitor(competitor: CompetitorItem): void {
    const hotelId = this.selectedHotelId();
    if (!hotelId) {
      return;
    }

    const confirmed = window.confirm(
      `Eliminar competidor "${competitor.name}" del hotel seleccionado?`
    );

    if (!confirmed) {
      return;
    }

    this.saving.set(true);
    this.competitorsService.deleteCompetitor(competitor.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.snackBar.open(`Competidor eliminado: ${competitor.name}`, 'Cerrar', { duration: 2500 });
        this.loadCompetitors(hotelId);
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('No fue posible eliminar el competidor.', 'Cerrar', { duration: 2500 });
      }
    });
  }

  onSaveRecommendationSettings(): void {
    const hotelId = this.selectedHotelId();
    if (!hotelId) {
      return;
    }
    if (this.recommendationSettingsForm.invalid || this.recommendationSettingsError()) {
      this.recommendationSettingsForm.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    const values = this.recommendationSettingsForm.getRawValue();
    const payload = {
      highOccupancyThreshold: Number(values.highOccupancyThreshold),
      lowOccupancyThreshold: Number(values.lowOccupancyThreshold),
      significantDiffPct: Number(values.significantDiffPct),
      demandWeight: Number(values.demandWeight),
      marketWeight: Number(values.marketWeight),
      maxAdjustmentPct: Number(values.maxAdjustmentPct),
      minActionStepPct: Number(values.minActionStepPct)
    };

    this.hotelsService
      .updateRecommendationSettings(hotelId, payload)
      .subscribe({
        next: ({ item }) => {
          this.saving.set(false);
          this.recommendationSettingsSource.set('custom');
          this.applyRecommendationSettings(item);
          this.snackBar.open('Parametros de recomendaciones actualizados.', 'Cerrar', {
            duration: 2500
          });
        },
        error: (error: HttpErrorResponse) => {
          this.saving.set(false);
          this.snackBar.open(
            this.extractApiErrorMessage(
              error,
              'No fue posible actualizar los parametros de recomendaciones.'
            ),
            'Cerrar',
            {
              duration: 4000
            }
          );
        }
      });
  }

  onResetRecommendationSettingsToDefault(): void {
    const hotelId = this.selectedHotelId();
    if (!hotelId) {
      return;
    }

    this.saving.set(true);
    this.hotelsService
      .updateRecommendationSettings(hotelId, { ...DEFAULT_RECOMMENDATION_SETTINGS })
      .subscribe({
        next: ({ item }) => {
          this.saving.set(false);
          this.recommendationSettingsSource.set('custom');
          this.applyRecommendationSettings(item);
          this.snackBar.open('Se restauraron los parametros base del motor.', 'Cerrar', {
            duration: 2500
          });
        },
        error: (error: HttpErrorResponse) => {
          this.saving.set(false);
          this.snackBar.open(
            this.extractApiErrorMessage(error, 'No fue posible restaurar los parametros base.'),
            'Cerrar',
            {
              duration: 4000
            }
          );
        }
      });
  }

  private loadHotels(preferredHotelId?: number): void {
    this.loadingHotels.set(true);
    this.hotelsError.set(null);

    this.hotelsService.getHotels().subscribe({
      next: ({ items }) => {
        this.hotels.set(items);
        this.loadingHotels.set(false);

        const selected = preferredHotelId ?? this.selectedHotelId() ?? items[0]?.id ?? null;
        this.selectedHotelId.set(selected);

        if (selected) {
          this.loadHotelDetail(selected);
          this.loadCompetitors(selected);
          this.loadRecommendationSettings(selected);
        } else {
          this.updateHotelForm.reset({
            code: '',
            name: '',
            totalRooms: 0,
            currency: 'MXN',
            timezone: 'America/Chihuahua'
          });
          this.competitors.set([]);
          this.competitorDrafts.set({});
          this.applyRecommendationSettings(DEFAULT_RECOMMENDATION_SETTINGS);
          this.recommendationSettingsSource.set('default');
        }
      },
      error: () => {
        this.loadingHotels.set(false);
        this.hotelsError.set('No fue posible cargar hoteles. Revisa conectividad y permisos.');
      }
    });
  }

  private loadHotelDetail(hotelId: number): void {
    this.hotelsService.getHotel(hotelId).subscribe({
      next: ({ item }) => {
        this.updateHotelForm.setValue({
          code: item.code,
          name: item.name,
          totalRooms: item.totalRooms,
          currency: item.currency,
          timezone: item.timezone
        });
      },
      error: () => {
        this.hotelsError.set('No fue posible consultar detalle del hotel seleccionado.');
      }
    });
  }

  private loadCompetitors(hotelId: number): void {
    this.loadingCompetitors.set(true);
    this.competitorsError.set(null);

    this.competitorsService.getCompetitorsByHotel(hotelId).subscribe({
      next: ({ items }) => {
        this.competitors.set(items);
        this.competitorDrafts.set(
          items.reduce<Record<number, string>>((acc, item) => {
            acc[item.id] = item.name;
            return acc;
          }, {})
        );
        this.loadingCompetitors.set(false);
      },
      error: () => {
        this.loadingCompetitors.set(false);
        this.competitorsError.set('No fue posible cargar competidores del hotel.');
      }
    });
  }

  private loadRecommendationSettings(hotelId: number): void {
    this.loadingRecommendationSettings.set(true);

    this.hotelsService.getRecommendationSettings(hotelId).subscribe({
      next: ({ item, isDefault }) => {
        this.loadingRecommendationSettings.set(false);
        this.applyRecommendationSettings(item);
        this.recommendationSettingsSource.set(isDefault ? 'default' : 'custom');
      },
      error: () => {
        this.loadingRecommendationSettings.set(false);
        this.applyRecommendationSettings(DEFAULT_RECOMMENDATION_SETTINGS);
        this.recommendationSettingsSource.set('default');
      }
    });
  }

  private applyRecommendationSettings(settings: RecommendationSettings): void {
    this.recommendationSettingsForm.setValue({
      highOccupancyThreshold: settings.highOccupancyThreshold,
      lowOccupancyThreshold: settings.lowOccupancyThreshold,
      significantDiffPct: settings.significantDiffPct,
      demandWeight: settings.demandWeight,
      marketWeight: settings.marketWeight,
      maxAdjustmentPct: settings.maxAdjustmentPct,
      minActionStepPct: settings.minActionStepPct
    });
  }

  private extractApiErrorMessage(error: HttpErrorResponse, fallback: string): string {
    const payload = error.error as { message?: string | string[] } | null;

    if (Array.isArray(payload?.message) && payload.message.length > 0) {
      return payload.message.join(' | ');
    }

    if (typeof payload?.message === 'string' && payload.message.trim().length > 0) {
      return payload.message;
    }

    return fallback;
  }
}
