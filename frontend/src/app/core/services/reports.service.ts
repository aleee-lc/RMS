import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DateRange } from '../models/date-range.model';
import { ReportResponse } from '../models/report.model';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class ReportsService {
  private readonly api = inject(ApiService);

  getPickupReport(dateRange: DateRange, hotelId = environment.defaultHotelId) {
    return this.api.get<ReportResponse>('/reports/pickup', {
      hotelId,
      bookingStartDate: dateRange.startDate,
      bookingEndDate: dateRange.endDate,
      stayStartDate: dateRange.startDate,
      stayEndDate: dateRange.endDate
    });
  }

  getForecastVarianceReport(dateRange: DateRange, hotelId = environment.defaultHotelId) {
    return this.getByRange('/reports/forecast-variance', dateRange, hotelId);
  }

  getMarketPositionReport(dateRange: DateRange, hotelId = environment.defaultHotelId) {
    return this.getByRange('/reports/market-position', dateRange, hotelId);
  }

  getRecommendationComplianceReport(
    dateRange: DateRange,
    tolerancePct = 2,
    hotelId = environment.defaultHotelId
  ) {
    return this.api.get<ReportResponse>('/reports/recommendation-compliance', {
      hotelId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      tolerancePct
    });
  }

  getRevenueOpportunityReport(dateRange: DateRange, hotelId = environment.defaultHotelId) {
    return this.getByRange('/reports/revenue-opportunity', dateRange, hotelId);
  }

  getExecutiveSummaryReport(dateRange: DateRange, hotelId = environment.defaultHotelId) {
    return this.getByRange('/reports/executive-summary', dateRange, hotelId);
  }

  getCrsReconciliationReport(
    dateRange: DateRange,
    whichDate: string,
    hotelId = environment.defaultHotelId
  ): Observable<ReportResponse> {
    return this.api.get<ReportResponse>('/reports/crs-reconciliation', {
      hotelId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      whichDate
    });
  }

  private getByRange(path: string, dateRange: DateRange, hotelId: number): Observable<ReportResponse> {
    return this.api.get<ReportResponse>(path, {
      hotelId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate
    });
  }
}
