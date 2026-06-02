import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  RawRateShoppingResult,
  RateShoppingScraper,
  RateShoppingSearchInput
} from './rate-shopping-scraper.interface';

interface MakCorpsMappingItem {
  document_id?: string | number;
  name?: string;
  type?: string;
  details?: {
    highlighted_name?: string;
    name?: string;
    geo_name?: string;
  };
}

@Injectable()
export class MakCorpsHotelApiProvider implements RateShoppingScraper {
  readonly name = 'makcorps-hotel-api';

  private readonly endpoint = process.env.MAKCORPS_HOTEL_ENDPOINT ?? 'https://api.makcorps.com/hotel';
  private readonly mappingEndpoint =
    process.env.MAKCORPS_MAPPING_ENDPOINT ?? 'https://api.makcorps.com/mapping';
  private readonly currency = (process.env.MAKCORPS_CURRENCY ?? 'MXN').trim().toUpperCase();
  private readonly rooms = Math.max(1, Number(process.env.MAKCORPS_ROOMS ?? 1));
  private readonly includeTax = `${process.env.MAKCORPS_INCLUDE_TAX ?? 'true'}` !== 'false';

  async scrape(input: RateShoppingSearchInput): Promise<RawRateShoppingResult[]> {
    const apiKey = this.apiKey();
    const hotelId = this.resolveConfiguredHotelId(input.targetHotelName);
    if (!hotelId) {
      throw new InternalServerErrorException(
        `MakCorps mapping missing for "${input.targetHotelName}". Add it to MAKCORPS_HOTEL_IDS_JSON.`
      );
    }

    const params = new URLSearchParams({
      api_key: apiKey,
      hotelid: hotelId,
      adults: String(input.adults),
      rooms: String(this.rooms),
      cur: this.currency,
      checkin: input.checkInDate.toISOString().slice(0, 10),
      checkout: input.checkOutDate.toISOString().slice(0, 10)
    });

    const response = await fetch(`${this.endpoint}?${params.toString()}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MakCorps API ${response.status}: ${body || 'empty response'}`);
    }

    const payload = (await response.json()) as { comparison?: unknown };
    return this.parseComparisonPayload(input.targetHotelName, input, payload);
  }

  async searchMapping(name: string): Promise<
    Array<{ documentId: string; name: string; highlightedName: string | null; geoName: string | null }>
  > {
    const apiKey = this.apiKey();
    const query = name.trim();
    if (!query) {
      return [];
    }

    const params = new URLSearchParams({
      api_key: apiKey,
      name: query
    });

    const response = await fetch(`${this.mappingEndpoint}?${params.toString()}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MakCorps mapping API ${response.status}: ${body || 'empty response'}`);
    }

    const payload = (await response.json()) as MakCorpsMappingItem[];
    if (!Array.isArray(payload)) {
      return [];
    }

    return payload
      .filter((item) => item.type === 'HOTEL' && item.document_id)
      .map((item) => ({
        documentId: String(item.document_id),
        name: item.name ?? item.details?.name ?? 'Unknown hotel',
        highlightedName: item.details?.highlighted_name ?? null,
        geoName: item.details?.geo_name ?? null
      }))
      .slice(0, 10);
  }

  private parseComparisonPayload(
    targetHotelName: string,
    input: RateShoppingSearchInput,
    payload: { comparison?: unknown }
  ): RawRateShoppingResult[] {
    const comparison = Array.isArray(payload.comparison) ? payload.comparison : [];
    const groups = comparison.flatMap((group) => (Array.isArray(group) ? group : []));
    const scrapedAt = new Date();
    const rows: RawRateShoppingResult[] = [];

    for (const group of groups) {
      if (!group || typeof group !== 'object') {
        continue;
      }

      const record = group as Record<string, unknown>;
      for (let index = 1; index <= 25; index += 1) {
        const vendor = this.readString(record[`vendor${index}`]);
        const priceText = this.readString(record[`price${index}`]);
        const taxText = this.readString(record[`tax${index}`]);

        if (!vendor) {
          continue;
        }

        const basePrice = this.parseMoney(priceText);
        const tax = this.parseMoney(taxText);
        const price =
          basePrice === null
            ? null
            : Number(
                (this.includeTax ? basePrice + (tax ?? 0) : basePrice).toFixed(2)
              );
        rows.push({
          hotelName: targetHotelName,
          source: vendor,
          price,
          currency: price !== null ? this.currency : null,
          availability: price !== null,
          occupancyAdults: input.adults,
          priceMode: 'total_stay',
          rawText: `${vendor} ${priceText ?? ''} ${taxText ?? ''}`.trim(),
          scrapedAt
        });
      }
    }

    return rows;
  }

  private resolveConfiguredHotelId(name: string): string | null {
    const raw = process.env.MAKCORPS_HOTEL_IDS_JSON?.trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, string | number>;
      const normalizedEntries = new Map(
        Object.entries(parsed).map(([key, value]) => [key.trim().toLowerCase(), String(value)])
      );
      return normalizedEntries.get(name.trim().toLowerCase()) ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(
        `Invalid MAKCORPS_HOTEL_IDS_JSON configuration: ${message}`
      );
    }
  }

  private apiKey(): string {
    const apiKey = process.env.MAKCORPS_API_KEY?.trim();
    if (!apiKey) {
      throw new InternalServerErrorException('MAKCORPS_API_KEY is not configured.');
    }
    return apiKey;
  }

  private parseMoney(value: string | null): number | null {
    if (!value) {
      return null;
    }

    const clean = value.replace(/[^\d.,-]/g, '');
    if (!clean) {
      return null;
    }

    const lastComma = clean.lastIndexOf(',');
    const lastDot = clean.lastIndexOf('.');
    const decimalSeparator = lastComma > lastDot ? ',' : '.';

    let normalized = clean;
    if (decimalSeparator === ',') {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    return Number(parsed.toFixed(2));
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
