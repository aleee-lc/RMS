import { HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DateRange } from '../models/date-range.model';
import { BiExecutiveSummaryResponse, RevenueCalendarResponse } from '../models/bi.model';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root',
})
export class BiService {
  private readonly api = inject(ApiService);

  getExecutiveSummary(
    dateRange: DateRange,
    hotelId = environment.defaultHotelId,
  ): Observable<BiExecutiveSummaryResponse> {
    return this.api.get<BiExecutiveSummaryResponse>('/bi/executive-summary', {
      hotelId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    });
  }

  getRevenueCalendar(
    dateRange: DateRange,
    hotelId = environment.defaultHotelId,
  ): Observable<RevenueCalendarResponse> {
    return this.api.get<RevenueCalendarResponse>('/bi/revenue-calendar', {
      hotelId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    });
  }

  exportCsv(
    dateRange: DateRange,
    hotelId = environment.defaultHotelId,
  ): Observable<HttpResponse<Blob>> {
    return this.api.getBlob('/bi/export/csv', {
      hotelId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    });
  }

  exportPdf(
    dateRange: DateRange,
    hotelId = environment.defaultHotelId,
  ): Observable<HttpResponse<Blob>> {
    return this.api.getBlob('/bi/export/pdf', {
      hotelId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    });
  }
}
