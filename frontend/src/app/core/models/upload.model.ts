export interface UploadResult {
  hotel?: {
    id: number;
    name: string;
    totalRooms: number;
  };
  source_file?: string;
  source_type?: string;
  reservations_parsed?: number;
  reservations_inserted?: number;
  metrics_recomputed_days?: number;
  rows_parsed?: number;
  history_rows?: number;
  forecast_rows?: number;
  daily_metrics_upserted?: number;
  datesProcessed?: number;
  competitorsUpserted?: number;
  marketRatesUpserted?: number;
  competitorRatesUpserted?: number;
  recommendations_generated?: number;
  pricing_opportunity_alerts_generated_or_updated?: number;
  competitive_set_alerts_generated_or_updated?: number;
  alerts_generated_or_updated?: number;
  date_range?: {
    start: string;
    end: string;
  };
  dateRange?: {
    start: string;
    end: string;
  };
  [key: string]: unknown;
}
