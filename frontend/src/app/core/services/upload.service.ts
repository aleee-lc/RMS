import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { UploadResult } from '../models/upload.model';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class UploadService {
  private readonly api = inject(ApiService);

  uploadXml(file: File): Observable<UploadResult> {
    const formData = new FormData();
    formData.append('file', file);
    return this.api.post<UploadResult>('/upload/xml', formData);
  }

  uploadExcel(file: File): Observable<UploadResult> {
    const formData = new FormData();
    formData.append('file', file);
    return this.api.post<UploadResult>('/upload/excel', formData);
  }
}
