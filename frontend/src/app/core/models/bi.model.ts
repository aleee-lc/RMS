export type BiSeverity = 'low' | 'medium' | 'high';

export type BiRecommendationAction =
  | 'increase-slightly'
  | 'increase-aggressively'
  | 'hold'
  | 'review-promotion'
  | 'decrease-moderately'
  | 'investigate-low-demand'
  | 'monitor-competition';

export interface BiSignal {
  type: string;
  title: string;
  severity: BiSeverity;
  message: string;
}

export interface BiPickup {
  rooms1d: number;
  rooms3d: number;
  rooms7d: number;
  rooms14d: number;
  roomNights7d: number;
  revenue7d: number;
  adr7d: number;
  accelerated: boolean;
}

export interface BiMarket {
  yourPrice: number | null;
  marketAverage: number | null;
  gapAmount: number | null;
  gapPct: number | null;
  position: 'below' | 'above' | 'aligned' | 'unknown';
  rank: number | null;
  rankTotal: number;
  cheapestCompetitor: { name: string; price: number } | null;
  mostExpensiveCompetitor: { name: string; price: number } | null;
  aggressiveDrops: Array<{ competitor: string; changePct: number }>;
}

export interface BiRecommendation {
  action: BiRecommendationAction;
  label: string;
  severity: BiSeverity;
  score: number;
  reason: string;
  evidence: string[];
  estimatedImpact: number;
}

export interface RevenueCalendarItem {
  date: string;
  daysToArrival: number;
  occupancy: number | null;
  bookedRooms: number | null;
  adr: number | null;
  revenue: number | null;
  pickup: BiPickup;
  market: BiMarket;
  opportunityScore: number;
  riskScore: number;
  suggestedAction: BiRecommendationAction;
  recommendation: BiRecommendation;
  signals: BiSignal[];
}

export interface RevenueCalendarResponse {
  hotel: {
    id: number;
    name: string;
    totalRooms: number;
  };
  date_range: {
    start: string;
    end: string;
  };
  count: number;
  items: RevenueCalendarItem[];
}

export interface BiExecutiveSummaryResponse {
  hotel: {
    id: number;
    name: string;
    totalRooms: number;
  };
  date_range: {
    start: string;
    end: string;
  };
  kpis: {
    avg_occupancy: number;
    avg_adr: number;
    total_revenue: number;
    active_alerts: number;
    high_occupancy_dates: number;
    extremely_low_dates: number;
    below_comp_set_dates: number;
    above_comp_set_dates: number;
  };
  top_pickup: RevenueCalendarItem[];
  top_opportunities: RevenueCalendarItem[];
  top_risks: RevenueCalendarItem[];
  high_occupancy_dates: RevenueCalendarItem[];
  extremely_low_dates: RevenueCalendarItem[];
  below_comp_set_dates: RevenueCalendarItem[];
  above_comp_set_dates: RevenueCalendarItem[];
}
