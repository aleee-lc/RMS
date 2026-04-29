import { inject, Injectable } from '@angular/core';
import {
  CompetitorItemResponse,
  CompetitorListResponse,
  DeleteCompetitorResponse
} from '../models/competitor.model';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class CompetitorsService {
  private readonly api = inject(ApiService);

  getCompetitorsByHotel(hotelId: number) {
    return this.api.get<CompetitorListResponse>(`/hotels/${hotelId}/competitors`);
  }

  createCompetitor(hotelId: number, name: string) {
    return this.api.post<CompetitorItemResponse>(`/hotels/${hotelId}/competitors`, { name });
  }

  updateCompetitor(id: number, name: string) {
    return this.api.patch<CompetitorItemResponse>(`/competitors/${id}`, { name });
  }

  deleteCompetitor(id: number) {
    return this.api.delete<DeleteCompetitorResponse>(`/competitors/${id}`);
  }
}
