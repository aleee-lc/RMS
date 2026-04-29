import { inject, Injectable } from '@angular/core';
import {
  CreateHotelPayload,
  HotelItemResponse,
  HotelListResponse,
  RecommendationSettingsResponse,
  UpdateRecommendationSettingsPayload,
  UpdateHotelPayload
} from '../models/hotel.model';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class HotelsService {
  private readonly api = inject(ApiService);

  getHotels() {
    return this.api.get<HotelListResponse>('/hotels');
  }

  getHotel(id: number) {
    return this.api.get<HotelItemResponse>(`/hotels/${id}`);
  }

  createHotel(payload: CreateHotelPayload) {
    return this.api.post<HotelItemResponse>('/hotels', payload);
  }

  updateHotel(id: number, payload: UpdateHotelPayload) {
    return this.api.patch<HotelItemResponse>(`/hotels/${id}`, payload);
  }

  getRecommendationSettings(hotelId: number) {
    return this.api.get<RecommendationSettingsResponse>(`/hotels/${hotelId}/recommendation-settings`);
  }

  updateRecommendationSettings(hotelId: number, payload: UpdateRecommendationSettingsPayload) {
    return this.api.patch<RecommendationSettingsResponse>(
      `/hotels/${hotelId}/recommendation-settings`,
      payload
    );
  }
}
