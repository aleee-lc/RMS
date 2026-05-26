export interface RateShopSummaryDateItem {
  date: string;
  currency: string | null;
  yourPrice: number | null;
  marketAverage: number | null;
  lowestPublicRate: number | null;
  highestPublicRate: number | null;
  competitorsBelowYou: number;
  competitorCount: number;
  gapPct: number | null;
  cheapestCompetitor: {
    name: string;
    price: number;
  } | null;
}

export interface RateShopSummaryResponse {
  hotel: {
    id: number;
    name: string;
    totalRooms: number;
  };
  query: {
    startDate: string | null;
    endDate: string | null;
    city: string | null;
  };
  lastScrapedAt: string | null;
  snapshotCount: number;
  datesCovered: number;
  spotlight: RateShopSummaryDateItem | null;
  items: RateShopSummaryDateItem[];
  cheapestPublicRates: Array<{
    date: string;
    competitorName: string | null;
    price: number | null;
    gapPct: number | null;
  }>;
}

export interface RunRateShoppingResponse {
  hotel: {
    id: number;
    name: string;
    totalRooms: number;
  };
  query: {
    hotelId: number;
    hotelName: string;
    city: string;
    checkInDate: string;
    checkOutDate: string;
    adults: number;
  };
  summary: {
    targetsRequested: number;
    targetsWithPrices: number;
    snapshotsPersisted: number;
    selectedCurrency: string | null;
    yourPrice: number | null;
    marketMin: number | null;
    marketMax: number | null;
    marketAverage: number | null;
    marketSampleSize: number;
    mixedCurrencyIgnoredCount: number;
    marketRateId: number | null;
    competitorRatesSynced: number;
  };
}
