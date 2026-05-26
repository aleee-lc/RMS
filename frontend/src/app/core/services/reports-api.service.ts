import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class ReportsApiService {
  private readonly api = inject(ApiService);

  obtenerRevenueCalendarPdf(id: string): Observable<Blob> {
    return this.api
      .getBlob(`/reports/revenue-calendar/${encodeURIComponent(id)}/pdf`)
      .pipe(map((response) => response.body ?? new Blob()));
  }
}
