import { Injectable } from '@nestjs/common';
import { round2 } from '../common/utils/number.util';
import {
  RawRateShoppingResult,
  RateShoppingSearchInput
} from './scrapers/rate-shopping-scraper.interface';

export interface NormalizedRateShoppingResult {
  competitorName: string;
  source: string;
  checkInDate: Date;
  checkOutDate: Date;
  adults: number;
  pricePerNight: number;
  currency: string;
  available: boolean;
  scrapedAt: Date;
}

@Injectable()
export class RateShoppingNormalizer {
  normalize(
    targetName: string,
    search: RateShoppingSearchInput,
    rows: RawRateShoppingResult[]
  ): NormalizedRateShoppingResult[] {
    const nights = this.countNights(search.checkInDate, search.checkOutDate);
    if (nights <= 0) {
      return [];
    }

    const out: NormalizedRateShoppingResult[] = [];

    for (const row of rows) {
      // Ignore unavailable and incomplete results.
      if (row.availability === false) {
        continue;
      }
      if (!row.price || row.price <= 0 || !row.currency) {
        continue;
      }
      if (row.occupancyAdults !== null && row.occupancyAdults !== search.adults) {
        continue;
      }

      const source = row.source.trim();
      if (!source) {
        continue;
      }

      const normalizedPrice =
        row.priceMode === 'total_stay'
          ? round2(row.price / nights)
          : row.priceMode === 'per_night'
            ? round2(row.price)
            : // unknown mode: assume nightly for conservative market comparison.
              round2(row.price);

      if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
        continue;
      }

      out.push({
        competitorName: targetName,
        source,
        checkInDate: search.checkInDate,
        checkOutDate: search.checkOutDate,
        adults: search.adults,
        pricePerNight: normalizedPrice,
        currency: row.currency.toUpperCase(),
        available: true,
        scrapedAt: row.scrapedAt
      });
    }

    // Deduplicate by source+price to avoid repeated cards in Google render.
    const dedup = new Map<string, NormalizedRateShoppingResult>();
    for (const item of out) {
      const key = `${item.source.toLowerCase()}|${item.pricePerNight}|${item.currency}`;
      if (!dedup.has(key)) {
        dedup.set(key, item);
      }
    }

    return [...dedup.values()];
  }

  private countNights(checkInDate: Date, checkOutDate: Date): number {
    const ms = checkOutDate.getTime() - checkInDate.getTime();
    return Math.round(ms / (24 * 60 * 60 * 1000));
  }
}
