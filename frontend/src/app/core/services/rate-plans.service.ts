import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  RatePlanDetail,
  RatePlanImportResult,
  RatePlanInsightsResponse,
  RatePlanListResponse
} from '../models/rate-plan.model';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class RatePlansService {
  private readonly api = inject(ApiService);

  importMaster(hotelId: number, file: File): Observable<RatePlanImportResult> {
    const formData = new FormData();
    formData.append('file', file);
    return this.api.post<RatePlanImportResult>(`/hotels/${hotelId}/rate-plans/import`, formData, {});
  }

  listRatePlans(
    hotelId: number,
    query?: {
      search?: string;
      marketSegment?: string;
      pricingStandard?: string;
      derivedOnly?: boolean;
      limit?: number;
    }
  ): Observable<RatePlanListResponse> {
    return this.api.get<RatePlanListResponse>(`/hotels/${hotelId}/rate-plans`, query ?? {});
  }

  getInsights(hotelId: number): Observable<RatePlanInsightsResponse> {
    return this.api.get<RatePlanInsightsResponse>(`/hotels/${hotelId}/rate-plans/insights`, {});
  }

  getRatePlan(hotelId: number, id: number): Observable<RatePlanDetail> {
    return this.api.get<RatePlanDetail>(`/hotels/${hotelId}/rate-plans/${id}`, {});
  }
}
