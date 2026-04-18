import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UploadResult } from '../models/upload.model';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class UploadService {
  private readonly api = inject(ApiService);

  uploadXml(file: File, hotelId = environment.defaultHotelId): Observable<UploadResult> {
    const formData = new FormData();
    formData.append('file', file);
    return this.api.post<UploadResult>('/upload/xml', formData, { hotelId });
  }

  uploadExcel(file: File, hotelId = environment.defaultHotelId): Observable<UploadResult> {
    const formData = new FormData();
    formData.append('file', file);
    return this.api.post<UploadResult>('/upload/excel', formData, { hotelId });
  }
}
