export type RecommendationAction = 'increase' | 'decrease' | 'hold';

export interface RecommendationItem {
  date: string;
  action: RecommendationAction;
  suggested_price: number;
  explanation: string;
  occupancy: number;
  your_price: number;
  market_average: number;
}

export interface RecommendationsResponse {
  hotel: {
    id: number;
    name: string;
    totalRooms: number;
  };
  startDate: string;
  endDate: string;
  horizon_days: number;
  count: number;
  items: RecommendationItem[];
}
