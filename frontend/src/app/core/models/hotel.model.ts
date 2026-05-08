export interface HotelSummary {
  id: number;
  name: string;
  totalRooms: number;
}

export interface RecommendationSettings {
  highOccupancyThreshold: number;
  lowOccupancyThreshold: number;
  significantDiffPct: number;
  demandWeight: number;
  marketWeight: number;
  maxAdjustmentPct: number;
  minActionStepPct: number;
}

export const DEFAULT_RECOMMENDATION_SETTINGS: RecommendationSettings = {
  highOccupancyThreshold: 70,
  lowOccupancyThreshold: 30,
  significantDiffPct: 5,
  demandWeight: 0.5,
  marketWeight: 0.6,
  maxAdjustmentPct: 5,
  minActionStepPct: 5
};

export interface HotelConfig extends HotelSummary {
  code: string;
  currency: string;
  timezone: string;
}

export interface HotelListResponse {
  count: number;
  items: HotelConfig[];
}

export interface HotelItemResponse {
  item: HotelConfig;
}

export interface CreateHotelPayload {
  code: string;
  name: string;
  totalRooms: number;
  currency?: string;
  timezone?: string;
}

export interface UpdateHotelPayload {
  code?: string;
  name?: string;
  totalRooms?: number;
  currency?: string;
  timezone?: string;
}

export interface RecommendationSettingsResponse {
  isDefault: boolean;
  item: RecommendationSettings;
}

export interface UpdateRecommendationSettingsPayload {
  highOccupancyThreshold?: number;
  lowOccupancyThreshold?: number;
  significantDiffPct?: number;
  demandWeight?: number;
  marketWeight?: number;
  maxAdjustmentPct?: number;
  minActionStepPct?: number;
}
