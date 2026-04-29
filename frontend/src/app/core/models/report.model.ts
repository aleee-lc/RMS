import { HotelSummary } from './hotel.model';

export interface ReportResponse<T = Record<string, unknown>> {
  hotel: HotelSummary;
  report: string;
  [key: string]: unknown;
  items?: T[];
}
