import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DateRange } from '../models/date-range.model';
import { MetricsResponse } from '../models/metric.model';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class MetricsService {
  private readonly api = inject(ApiService);

  getMetrics(dateRange: DateRange, hotelId = environment.defaultHotelId): Observable<MetricsResponse> {
    return this.api.get<MetricsResponse>('/metrics', {
      hotelId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate
    });
  }
}
