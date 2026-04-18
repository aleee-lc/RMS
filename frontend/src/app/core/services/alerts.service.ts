import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AlertsResponse } from '../models/alert.model';
import { DateRange } from '../models/date-range.model';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class AlertsService {
  private readonly api = inject(ApiService);

  getAlerts(
    options: DateRange & { resolved?: boolean },
    hotelId = environment.defaultHotelId
  ): Observable<AlertsResponse> {
    return this.api.get<AlertsResponse>('/alerts', {
      hotelId,
      startDate: options.startDate,
      endDate: options.endDate,
      resolved: options.resolved
    });
  }
}
