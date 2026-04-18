import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { finalize } from 'rxjs';
import { UploadResult } from '../../core/models/upload.model';
import { UploadService } from '../../core/services/upload.service';

@Component({
  selector: 'app-upload-page',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './upload-page.component.html',
  styleUrl: './upload-page.component.scss'
})
export class UploadPageComponent {
  readonly xmlUploading = signal(false);
  readonly excelUploading = signal(false);
  readonly xmlResult = signal<UploadResult | null>(null);
  readonly excelResult = signal<UploadResult | null>(null);

  constructor(
    private readonly uploadService: UploadService,
    private readonly snackBar: MatSnackBar
  ) {}

  onXmlFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.xmlUploading.set(true);
    this.uploadService
      .uploadXml(file)
      .pipe(finalize(() => this.xmlUploading.set(false)))
      .subscribe((result) => {
        this.xmlResult.set(result);
        this.snackBar.open('XML cargado correctamente.', 'Cerrar', { duration: 3000 });
      });

    input.value = '';
  }

  onExcelFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.excelUploading.set(true);
    this.uploadService
      .uploadExcel(file)
      .pipe(finalize(() => this.excelUploading.set(false)))
      .subscribe((result) => {
        this.excelResult.set(result);
        this.snackBar.open('Excel cargado correctamente.', 'Cerrar', { duration: 3000 });
      });

    input.value = '';
  }
}
