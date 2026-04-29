import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DateRange } from '../models/date-range.model';
import { RecommendationsResponse } from '../models/recommendation.model';
import { UpdateRecommendationSettingsPayload } from '../models/hotel.model';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class RecommendationsService {
  private readonly api = inject(ApiService);

  getRecommendations(
    dateRange: DateRange,
    hotelId = environment.defaultHotelId
  ): Observable<RecommendationsResponse> {
    return this.api.get<RecommendationsResponse>('/recommendations', {
      hotelId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate
    });
  }

  generateRecommendations(
    dateRange: DateRange,
    options?: UpdateRecommendationSettingsPayload,
    hotelId = environment.defaultHotelId
  ): Observable<RecommendationsResponse> {
    return this.api.post<RecommendationsResponse>(
      '/recommendations/generate',
      options ?? {},
      {
        hotelId,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      }
    );
  }
}
