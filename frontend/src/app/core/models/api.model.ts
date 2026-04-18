import { HotelSummary } from './hotel.model';

export interface PagedResponse<T> {
  hotel?: HotelSummary;
  count: number;
  items: T[];
}
