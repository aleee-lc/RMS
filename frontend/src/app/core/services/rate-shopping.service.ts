import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { DateRange } from '../models/date-range.model';
import {
  RateShopSummaryResponse,
  RunRateShoppingResponse
} from '../models/rate-shopping.model';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class RateShoppingService {
  private readonly api = inject(ApiService);

  getSummary(dateRange: DateRange, city?: string): Observable<RateShopSummaryResponse> {
    return this.api.get<RateShopSummaryResponse>('/rate-shopping/summary', {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      city
    });
  }

  run(input: {
    city: string;
    checkInDate: string;
    checkOutDate: string;
    adults: number;
    includeHotelSelf?: boolean;
    competitorNames?: string[];
  }): Observable<RunRateShoppingResponse> {
    return this.api.post<RunRateShoppingResponse>('/rate-shopping/run', {
      city: input.city,
      checkInDate: input.checkInDate,
      checkOutDate: input.checkOutDate,
      adults: input.adults,
      includeHotelSelf: input.includeHotelSelf ?? true,
      competitorNames: input.competitorNames
    });
  }
}
