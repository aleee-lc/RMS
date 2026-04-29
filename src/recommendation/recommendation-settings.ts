import { clamp } from '../common/utils/number.util';

export interface RecommendationSettingsConfig {
  highOccupancyThreshold: number;
  lowOccupancyThreshold: number;
  significantDiffPct: number;
  demandWeight: number;
  marketWeight: number;
  maxAdjustmentPct: number;
  minActionStepPct: number;
}

export const DEFAULT_RECOMMENDATION_SETTINGS: RecommendationSettingsConfig = {
  highOccupancyThreshold: 70,
  lowOccupancyThreshold: 30,
  significantDiffPct: 5,
  demandWeight: 0.5,
  marketWeight: 0.6,
  maxAdjustmentPct: 5,
  minActionStepPct: 5
};

export function normalizeRecommendationSettings(
  input?: Partial<RecommendationSettingsConfig> | null
): RecommendationSettingsConfig {
  const merged: RecommendationSettingsConfig = {
    ...DEFAULT_RECOMMENDATION_SETTINGS,
    ...(input ?? {})
  };

  merged.highOccupancyThreshold = clamp(merged.highOccupancyThreshold, 0, 100);
  merged.lowOccupancyThreshold = clamp(merged.lowOccupancyThreshold, 0, 100);
  merged.significantDiffPct = clamp(merged.significantDiffPct, 0, 100);
  merged.demandWeight = clamp(merged.demandWeight, 0, 2);
  merged.marketWeight = clamp(merged.marketWeight, 0, 2);
  merged.maxAdjustmentPct = clamp(merged.maxAdjustmentPct, 1, 40);
  merged.minActionStepPct = clamp(merged.minActionStepPct, 0.5, 20);

  if (merged.lowOccupancyThreshold >= merged.highOccupancyThreshold) {
    merged.lowOccupancyThreshold = Math.max(0, merged.highOccupancyThreshold - 1);
  }
  if (merged.minActionStepPct > merged.maxAdjustmentPct) {
    merged.minActionStepPct = merged.maxAdjustmentPct;
  }

  return merged;
}
