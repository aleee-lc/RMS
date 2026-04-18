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
  date_range?: {
    start: string;
    end: string;
  };
  [key: string]: unknown;
}
