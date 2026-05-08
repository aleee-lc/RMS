import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { finalize } from 'rxjs';
import { UploadResult } from '../../core/models/upload.model';
import { UploadService } from '../../core/services/upload.service';

type UploadType = 'xml' | 'excel';

@Component({
  selector: 'app-upload-page',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
  ],
  templateUrl: './upload-page.component.html',
  styleUrl: './upload-page.component.scss',
})
export class UploadPageComponent {
  readonly selectedType = signal<UploadType>('xml');
  readonly selectedFile = signal<File | null>(null);
  readonly uploading = signal(false);
  readonly showRawResult = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly lastResult = signal<UploadResult | null>(null);

  readonly validationItems = computed(() => {
    const file = this.selectedFile();
    const type = this.selectedType();
    const expectedExt = type === 'xml' ? '.xml' : '.xlsx/.xls';

    const extensionOk = this.isFileExtensionValid(file, type);
    const sizeOk = !file || file.size <= 40 * 1024 * 1024;

    return [
      {
        label: `Archivo seleccionado (${expectedExt})`,
        ok: Boolean(file),
      },
      {
        label: 'Formato valido',
        ok: extensionOk,
      },
      {
        label: 'Tamano menor a 40MB',
        ok: sizeOk,
      },
    ];
  });

  readonly canUpload = computed(() => this.validationItems().every((item) => item.ok));
  readonly sourceStatusCards = computed(() => {
    const result = this.lastResult();
    return [
      {
        label: 'ResEnteredOnBy',
        source: 'XML Opera/CRS',
        status:
          result?.source_type === 'reservation_entered_on'
            ? 'Actualizado'
            : 'Pendiente de nueva carga',
        metric:
          result?.source_type === 'reservation_entered_on'
            ? `${result.reservations_inserted ?? 0} reservas`
            : 'Sin cambios en esta sesion',
        icon: 'person_add',
      },
      {
        label: 'History & Forecast',
        source: 'Forecast Opera',
        status:
          result?.source_type === 'history_forecast' ? 'Actualizado' : 'Pendiente de nueva carga',
        metric:
          result?.source_type === 'history_forecast'
            ? `${result.daily_metrics_upserted ?? 0} fechas`
            : 'Sin cambios en esta sesion',
        icon: 'show_chart',
      },
      {
        label: 'PriceGrid / Expedia',
        source: 'Comp set',
        status:
          result?.source_type === 'expedia_price_grid' ? 'Actualizado' : 'Pendiente de nueva carga',
        metric:
          result?.source_type === 'expedia_price_grid'
            ? `${result.marketRatesUpserted ?? 0} tarifas · ${result.alerts_generated_or_updated ?? 0} alertas`
            : 'Sin cambios en esta sesion',
        icon: 'travel_explore',
      },
    ];
  });

  constructor(
    private readonly uploadService: UploadService,
    private readonly snackBar: MatSnackBar,
  ) {}

  onTypeChange(type: UploadType): void {
    this.selectedType.set(type);
    this.selectedFile.set(null);
    this.errorMessage.set(null);
    this.lastResult.set(null);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    this.selectedFile.set(file);
    this.errorMessage.set(null);

    if (!file) {
      return;
    }

    if (!this.isFileExtensionValid(file, this.selectedType())) {
      const expected = this.selectedType() === 'xml' ? '.xml' : '.xlsx o .xls';
      this.selectedFile.set(null);
      this.errorMessage.set(`Formato invalido. Debe ser ${expected}.`);
    }

    if (file.size > 40 * 1024 * 1024) {
      this.selectedFile.set(null);
      this.errorMessage.set('El archivo excede 40MB. Divide la carga o usa un archivo menor.');
    }

    input.value = '';
  }

  onUpload(): void {
    const file = this.selectedFile();
    const type = this.selectedType();

    if (!file) {
      this.errorMessage.set('Selecciona un archivo antes de subir.');
      return;
    }

    if (!this.canUpload()) {
      this.errorMessage.set('Corrige validaciones antes de subir.');
      return;
    }

    this.uploading.set(true);
    this.errorMessage.set(null);

    const request$ =
      type === 'xml' ? this.uploadService.uploadXml(file) : this.uploadService.uploadExcel(file);

    request$.pipe(finalize(() => this.uploading.set(false))).subscribe({
      next: (result) => {
        this.lastResult.set(result);
        this.snackBar.open('Carga completada con exito.', 'Cerrar', { duration: 2600 });
      },
      error: () => {
        this.errorMessage.set(
          'No fue posible procesar el archivo. Revisa formato y vuelve a intentar.',
        );
      },
    });
  }

  toggleRawResult(): void {
    this.showRawResult.update((current) => !current);
  }

  resultSummaryRows(result: UploadResult): Array<{ label: string; value: string }> {
    const rows: Array<{ label: string; value: string }> = [];

    if (result.source_type) {
      rows.push({ label: 'Tipo de fuente', value: String(result.source_type) });
    }
    if (typeof result.reservations_parsed === 'number') {
      rows.push({ label: 'Reservas parseadas', value: String(result.reservations_parsed) });
    }
    if (typeof result.reservations_inserted === 'number') {
      rows.push({ label: 'Reservas insertadas', value: String(result.reservations_inserted) });
    }
    if (typeof result.rows_parsed === 'number') {
      rows.push({ label: 'Filas parseadas', value: String(result.rows_parsed) });
    }
    if (typeof result.daily_metrics_upserted === 'number') {
      rows.push({ label: 'Metricas actualizadas', value: String(result.daily_metrics_upserted) });
    }
    if (typeof result.marketRatesUpserted === 'number') {
      rows.push({
        label: 'Tarifas de mercado actualizadas',
        value: String(result.marketRatesUpserted),
      });
    }
    if (typeof result.competitorsUpserted === 'number') {
      rows.push({ label: 'Competidores detectados', value: String(result.competitorsUpserted) });
    }
    if (typeof result.competitorRatesUpserted === 'number') {
      rows.push({
        label: 'Tarifas de competidores actualizadas',
        value: String(result.competitorRatesUpserted),
      });
    }
    if (typeof result.recommendations_generated === 'number') {
      rows.push({
        label: 'Recomendaciones generadas',
        value: String(result.recommendations_generated),
      });
    }
    if (typeof result.competitive_set_alerts_generated_or_updated === 'number') {
      rows.push({
        label: 'Alertas comp set',
        value: String(result.competitive_set_alerts_generated_or_updated),
      });
    }
    if (typeof result.pricing_opportunity_alerts_generated_or_updated === 'number') {
      rows.push({
        label: 'Alertas oportunidad precio',
        value: String(result.pricing_opportunity_alerts_generated_or_updated),
      });
    }
    if (typeof result.alerts_generated_or_updated === 'number') {
      rows.push({
        label: 'Alertas generadas/actualizadas',
        value: String(result.alerts_generated_or_updated),
      });
    }

    const dateRange = result.date_range ?? result.dateRange;
    if (dateRange?.start && dateRange?.end) {
      rows.push({ label: 'Rango aplicado', value: `${dateRange.start} -> ${dateRange.end}` });
    }

    if (rows.length === 0) {
      rows.push({ label: 'Resultado', value: 'Archivo procesado correctamente' });
    }

    return rows;
  }

  private isFileExtensionValid(file: File | null, type: UploadType): boolean {
    if (!file) {
      return false;
    }

    if (type === 'xml') {
      return /\.xml$/i.test(file.name);
    }

    return /\.(xlsx|xls)$/i.test(file.name);
  }
}
