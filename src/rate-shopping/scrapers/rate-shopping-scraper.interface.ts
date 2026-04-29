export type RatePriceMode = 'per_night' | 'total_stay' | 'unknown';

export interface RateShoppingSearchInput {
  targetHotelName: string;
  city: string;
  checkInDate: Date;
  checkOutDate: Date;
  adults: number;
}

export interface RawRateShoppingResult {
  hotelName: string;
  source: string;
  price: number | null;
  currency: string | null;
  availability: boolean | null;
  occupancyAdults: number | null;
  priceMode: RatePriceMode;
  rawText: string;
  scrapedAt: Date;
}

export interface RateShoppingScraper {
  readonly name: string;
  scrape(input: RateShoppingSearchInput): Promise<RawRateShoppingResult[]>;
}
