import { CommonModule } from '@angular/common';
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
import { CompetitorItem } from '../../core/models/competitor.model';
import { HotelConfig } from '../../core/models/hotel.model';
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
    MatSnackBarModule
  ],
  templateUrl: './configuration-page.component.html',
  styleUrl: './configuration-page.component.scss'
})
export class ConfigurationPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);

  readonly loadingHotels = signal(false);
  readonly loadingCompetitors = signal(false);
  readonly saving = signal(false);

  readonly hotelsError = signal<string | null>(null);
  readonly competitorsError = signal<string | null>(null);

  readonly hotels = signal<HotelConfig[]>([]);
  readonly competitors = signal<CompetitorItem[]>([]);
  readonly selectedHotelId = signal<number | null>(null);
  readonly competitorDrafts = signal<Record<number, string>>({});

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
}
