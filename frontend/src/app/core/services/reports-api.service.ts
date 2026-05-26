import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiService } from './api.service';
import { DateRange } from '../models/date-range.model';

@Injectable({
  providedIn: 'root'
})
export class ReportsApiService {
  private readonly api = inject(ApiService);

  obtenerRevenueCalendarPdf(id: string, dateRange?: DateRange): Observable<Blob> {
    return this.api
      .getBlob(`/reports/revenue-calendar/${encodeURIComponent(id)}/pdf`, {
        startDate: dateRange?.startDate,
        endDate: dateRange?.endDate
      })
      .pipe(map((response) => response.body ?? new Blob()));
  }
}
