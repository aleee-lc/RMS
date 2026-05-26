import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dateKey, toUtcDateOnly } from '../common/utils/date.util';
import { round2 } from '../common/utils/number.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  RateShoppingNormalizer,
  NormalizedRateShoppingResult
} from './rate-shopping.normalizer';
import {
  RateShoppingScraper,
  RateShoppingSearchInput
} from './scrapers/rate-shopping-scraper.interface';

export const RATE_SHOPPING_SCRAPERS = Symbol('RATE_SHOPPING_SCRAPERS');

interface TargetBestOffer {
  targetName: string;
  source: string;
  pricePerNight: number;
  currency: string;
}

interface TargetExecutionResult {
  targetName: string;
  scraperErrors: string[];
  rawRows: number;
  normalizedRows: number;
  bestOffer: TargetBestOffer | null;
}

export interface RunRateShoppingInput {
  hotelId: number;
  city: string;
  checkInDate: Date;
  checkOutDate: Date;
  adults: number;
  includeHotelSelf?: boolean;
  competitorNames?: string[];
}

interface RateShopSummaryDateItem {
  date: string;
  currency: string | null;
  yourPrice: number | null;
  marketAverage: number | null;
  lowestPublicRate: number | null;
  highestPublicRate: number | null;
  competitorsBelowYou: number;
  competitorCount: number;
  gapPct: number | null;
  cheapestCompetitor: { name: string; price: number } | null;
}

type RateShopSnapshotListItem = Awaited<ReturnType<PrismaService['rateShopSnapshot']['findMany']>>[number];

@Injectable()
export class RateShoppingService {
  private readonly logger = new Logger(RateShoppingService.name);
  private readonly targetDelayMs = Number(process.env.RATE_SHOPPING_TARGET_DELAY_MS ?? 1200);

  constructor(
    private readonly prisma: PrismaService,
    private readonly normalizer: RateShoppingNormalizer,
    @Inject(RATE_SHOPPING_SCRAPERS) private readonly scrapers: RateShoppingScraper[]
  ) {}

  async runForHotel(input: RunRateShoppingInput) {
    const hotel = await this.prisma.hotel.findUnique({
      where: { id: input.hotelId },
      select: { id: true, name: true, currency: true }
    });
    if (!hotel) {
      throw new NotFoundException(`Hotel ${input.hotelId} not found`);
    }

    const includeHotelSelf = input.includeHotelSelf ?? true;
    const competitorNames = await this.resolveCompetitorNames(input.hotelId, input.competitorNames);

    const targets: string[] = [];
    if (includeHotelSelf) {
      targets.push(hotel.name);
    }
    targets.push(...competitorNames);

    const uniqueTargets = [...new Set(targets.map((item) => item.trim()).filter(Boolean))];

    const targetResults: TargetExecutionResult[] = [];
    const normalizedRowsAllTargets: NormalizedRateShoppingResult[] = [];

    for (const targetName of uniqueTargets) {
      const searchInput: RateShoppingSearchInput = {
        targetHotelName: targetName,
        city: input.city,
        checkInDate: toUtcDateOnly(input.checkInDate),
        checkOutDate: toUtcDateOnly(input.checkOutDate),
        adults: input.adults
      };

      const execution = await this.executeTarget(searchInput);
      targetResults.push(execution.result);
      normalizedRowsAllTargets.push(...execution.normalizedRows);

      if (this.targetDelayMs > 0) {
        await this.sleep(this.targetDelayMs);
      }
    }

    if (normalizedRowsAllTargets.length > 0) {
      await this.prisma.rateShopSnapshot.createMany({
        data: normalizedRowsAllTargets.map((row) => ({
          hotelId: input.hotelId,
          competitorName: row.competitorName,
          source: row.source,
          checkInDate: row.checkInDate,
          checkOutDate: row.checkOutDate,
          adults: row.adults,
          price: row.pricePerNight,
          currency: row.currency,
          available: row.available,
          scrapedAt: row.scrapedAt
        }))
      });
    }

    const bestByTarget = new Map<string, TargetBestOffer>();
    for (const execution of targetResults) {
      if (execution.bestOffer) {
        bestByTarget.set(execution.targetName, execution.bestOffer);
      }
    }

    const selfBestOffer = includeHotelSelf ? bestByTarget.get(hotel.name) ?? null : null;
    const competitorBestOffers = competitorNames
      .map((name) => bestByTarget.get(name) ?? null)
      .filter((item): item is TargetBestOffer => item !== null);

    const selectedCurrency =
      this.pickDominantCurrency(competitorBestOffers.map((item) => item.currency)) ??
      selfBestOffer?.currency ??
      hotel.currency;

    const competitorMarketOffers = competitorBestOffers.filter(
      (item) => item.currency === selectedCurrency
    );

    const marketStats = this.computeMarketStats(competitorMarketOffers.map((item) => item.pricePerNight));
    const marketSync = await this.syncMarketRates({
      hotelId: input.hotelId,
      checkInDate: toUtcDateOnly(input.checkInDate),
      yourPrice: selfBestOffer?.currency === selectedCurrency ? selfBestOffer.pricePerNight : null,
      marketAverage: marketStats.average,
      currency: selectedCurrency,
      competitorOffers: competitorMarketOffers
    });

    return {
      query: {
        hotelId: hotel.id,
        hotelName: hotel.name,
        city: input.city,
        checkInDate: dateKey(input.checkInDate),
        checkOutDate: dateKey(input.checkOutDate),
        adults: input.adults
      },
      summary: {
        targetsRequested: uniqueTargets.length,
        targetsWithPrices: targetResults.filter((item) => item.bestOffer !== null).length,
        snapshotsPersisted: normalizedRowsAllTargets.length,
        selectedCurrency,
        yourPrice: selfBestOffer?.pricePerNight ?? null,
        marketMin: marketStats.min,
        marketMax: marketStats.max,
        marketAverage: marketStats.average,
        marketSampleSize: competitorMarketOffers.length,
        mixedCurrencyIgnoredCount: competitorBestOffers.length - competitorMarketOffers.length,
        marketRateId: marketSync.marketRateId,
        competitorRatesSynced: marketSync.competitorRatesSynced
      },
      targets: targetResults
    };
  }

  async listSnapshots(params: {
    hotelId: number;
    startDate?: Date;
    endDate?: Date;
    competitorName?: string;
    limit?: number;
  }) {
    const where: Prisma.RateShopSnapshotWhereInput = {
      hotelId: params.hotelId
    };

    if (params.startDate || params.endDate) {
      where.checkInDate = {};
      if (params.startDate) {
        where.checkInDate.gte = toUtcDateOnly(params.startDate);
      }
      if (params.endDate) {
        where.checkInDate.lte = toUtcDateOnly(params.endDate);
      }
    }

    if (params.competitorName) {
      where.competitorName = {
        contains: params.competitorName.trim(),
        mode: 'insensitive'
      };
    }

    return this.prisma.rateShopSnapshot.findMany({
      where,
      orderBy: [{ checkInDate: 'asc' }, { scrapedAt: 'desc' }],
      take: Math.min(Math.max(params.limit ?? 250, 1), 1000)
    });
  }

  async getSummary(params: {
    hotelId: number;
    startDate?: Date;
    endDate?: Date;
    city?: string | null;
  }) {
    const hotel = await this.prisma.hotel.findUnique({
      where: { id: params.hotelId },
      select: { id: true, name: true, currency: true }
    });

    if (!hotel) {
      throw new NotFoundException(`Hotel ${params.hotelId} not found`);
    }

    try {
      const snapshots = await this.listSnapshots({
        hotelId: params.hotelId,
        startDate: params.startDate,
        endDate: params.endDate,
        limit: 1000
      });

      const latestByDateCompetitor = new Map<string, (typeof snapshots)[number]>();
      for (const snapshot of snapshots) {
        const key = `${dateKey(snapshot.checkInDate)}::${snapshot.competitorName}`;
        const current = latestByDateCompetitor.get(key);
        if (!current || snapshot.scrapedAt > current.scrapedAt) {
          latestByDateCompetitor.set(key, snapshot);
        }
      }

      const byDate = new Map<string, RateShopSnapshotListItem[]>();
      for (const snapshot of latestByDateCompetitor.values()) {
        const key = dateKey(snapshot.checkInDate);
        const items = byDate.get(key) ?? [];
        items.push(snapshot);
        byDate.set(key, items);
      }

      const items = [...byDate.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, rows]) => this.buildSummaryDateItem(hotel.name, date, rows));

      const spotlight = items[0] ?? null;
      const latestScrapedAt =
        snapshots.length > 0
          ? new Date(
              Math.max(...snapshots.map((snapshot) => snapshot.scrapedAt.getTime()))
            ).toISOString()
          : null;

      return {
        query: {
          startDate: params.startDate ? dateKey(params.startDate) : null,
          endDate: params.endDate ? dateKey(params.endDate) : null,
          city: params.city ?? null
        },
        lastScrapedAt: latestScrapedAt,
        snapshotCount: snapshots.length,
        datesCovered: items.length,
        spotlight,
        items,
        cheapestPublicRates: items
          .filter((item) => item.cheapestCompetitor)
          .slice(0, 5)
          .map((item) => ({
            date: item.date,
            competitorName: item.cheapestCompetitor?.name ?? null,
            price: item.cheapestCompetitor?.price ?? null,
            gapPct: item.gapPct
          }))
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Rate shopping summary failed for hotel ${params.hotelId}: ${message}`);

      return {
        query: {
          startDate: params.startDate ? dateKey(params.startDate) : null,
          endDate: params.endDate ? dateKey(params.endDate) : null,
          city: params.city ?? null
        },
        lastScrapedAt: null,
        snapshotCount: 0,
        datesCovered: 0,
        spotlight: null,
        items: [],
        cheapestPublicRates: []
      };
    }
  }

  async runDailyForAllHotels() {
    const defaultCity = (process.env.RATE_SHOPPING_DEFAULT_CITY ?? '').trim();
    if (!defaultCity) {
      this.logger.warn(
        'Daily rate shopping skipped: RATE_SHOPPING_DEFAULT_CITY is empty. Configure city explicitly.'
      );
      return {
        hotelsProcessed: 0,
        results: [] as Array<{ hotelId: number; status: 'skipped'; reason: string }>
      };
    }

    const lookAheadDays = Math.max(0, Number(process.env.RATE_SHOPPING_LOOKAHEAD_DAYS ?? 14));
    const lengthOfStay = Math.max(1, Number(process.env.RATE_SHOPPING_LENGTH_OF_STAY ?? 1));
    const adults = Math.max(1, Number(process.env.RATE_SHOPPING_ADULTS ?? 2));

    const checkInDate = toUtcDateOnly(new Date());
    checkInDate.setUTCDate(checkInDate.getUTCDate() + lookAheadDays);
    const checkOutDate = new Date(checkInDate);
    checkOutDate.setUTCDate(checkOutDate.getUTCDate() + lengthOfStay);

    const hotels = await this.prisma.hotel.findMany({
      orderBy: { id: 'asc' }
    });

    const results: Array<{ hotelId: number; status: 'ok' | 'error'; message?: string }> = [];

    for (const hotel of hotels) {
      try {
        await this.runForHotel({
          hotelId: hotel.id,
          city: defaultCity,
          checkInDate,
          checkOutDate,
          adults,
          includeHotelSelf: true
        });

        results.push({ hotelId: hotel.id, status: 'ok' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Daily rate shopping failed for hotel ${hotel.id}: ${message}`);
        results.push({ hotelId: hotel.id, status: 'error', message });
      }
    }

    return {
      hotelsProcessed: hotels.length,
      checkInDate: dateKey(checkInDate),
      checkOutDate: dateKey(checkOutDate),
      adults,
      results
    };
  }

  private async executeTarget(input: RateShoppingSearchInput): Promise<{
    result: TargetExecutionResult;
    normalizedRows: NormalizedRateShoppingResult[];
  }> {
    const allRawRows = [];
    const scraperErrors: string[] = [];

    for (const scraper of this.scrapers) {
      try {
        const rows = await scraper.scrape(input);
        allRawRows.push(...rows);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        scraperErrors.push(`${scraper.name}: ${message}`);
      }
    }

    const normalizedRows = this.normalizer.normalize(input.targetHotelName, input, allRawRows);
    const bestOffer =
      normalizedRows.length > 0
        ? normalizedRows.reduce((best, current) =>
            current.pricePerNight < best.pricePerNight ? current : best
          )
        : null;

    return {
      result: {
        targetName: input.targetHotelName,
        scraperErrors,
        rawRows: allRawRows.length,
        normalizedRows: normalizedRows.length,
        bestOffer: bestOffer
          ? {
              targetName: input.targetHotelName,
              source: bestOffer.source,
              pricePerNight: bestOffer.pricePerNight,
              currency: bestOffer.currency
            }
          : null
      },
      normalizedRows
    };
  }

  private async resolveCompetitorNames(hotelId: number, inputNames?: string[]): Promise<string[]> {
    const provided = (inputNames ?? [])
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    if (provided.length > 0) {
      return [...new Set(provided)];
    }

    const competitors = await this.prisma.competitor.findMany({
      where: { hotelId },
      orderBy: { name: 'asc' },
      select: { name: true }
    });

    return competitors.map((item) => item.name);
  }

  private pickDominantCurrency(currencies: string[]): string | null {
    if (currencies.length === 0) {
      return null;
    }

    const counts = new Map<string, number>();
    for (const currency of currencies) {
      counts.set(currency, (counts.get(currency) ?? 0) + 1);
    }

    let selected: string | null = null;
    let maxCount = -1;
    for (const [currency, count] of counts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        selected = currency;
      }
    }

    return selected;
  }

  private computeMarketStats(values: number[]): {
    min: number | null;
    max: number | null;
    average: number | null;
  } {
    if (values.length === 0) {
      return { min: null, max: null, average: null };
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;

    return {
      min: round2(min),
      max: round2(max),
      average: round2(avg)
    };
  }

  private async syncMarketRates(params: {
    hotelId: number;
    checkInDate: Date;
    yourPrice: number | null;
    marketAverage: number | null;
    currency: string;
    competitorOffers: TargetBestOffer[];
  }): Promise<{ marketRateId: number | null; competitorRatesSynced: number }> {
    if (params.yourPrice === null && params.marketAverage === null && params.competitorOffers.length === 0) {
      return {
        marketRateId: null,
        competitorRatesSynced: 0
      };
    }

    const updateData: Prisma.MarketRatesUpdateInput = {
      sourceFile: `rate-shopping:${new Date().toISOString()}`
    };
    if (params.yourPrice !== null) {
      updateData.yourPrice = params.yourPrice;
    }
    if (params.marketAverage !== null) {
      updateData.marketAverage = params.marketAverage;
    }

    const marketRate = await this.prisma.marketRates.upsert({
      where: {
        hotelId_date: {
          hotelId: params.hotelId,
          date: params.checkInDate
        }
      },
      update: updateData,
      create: {
        hotelId: params.hotelId,
        date: params.checkInDate,
        yourPrice: params.yourPrice,
        marketAverage: params.marketAverage,
        sourceFile: `rate-shopping:${new Date().toISOString()}`
      }
    });

    let competitorRatesSynced = 0;
    for (const competitorOffer of params.competitorOffers) {
      const competitor = await this.prisma.competitor.upsert({
        where: {
          hotelId_name: {
            hotelId: params.hotelId,
            name: competitorOffer.targetName
          }
        },
        update: {},
        create: {
          hotelId: params.hotelId,
          name: competitorOffer.targetName
        }
      });

      await this.prisma.competitorMarketRates.upsert({
        where: {
          competitorId_marketRateId: {
            competitorId: competitor.id,
            marketRateId: marketRate.id
          }
        },
        update: {
          price: competitorOffer.pricePerNight
        },
        create: {
          competitorId: competitor.id,
          marketRateId: marketRate.id,
          price: competitorOffer.pricePerNight
        }
      });

      competitorRatesSynced += 1;
    }

    return {
      marketRateId: marketRate.id,
      competitorRatesSynced
    };
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private buildSummaryDateItem(
    hotelName: string,
    date: string,
    rows: RateShopSnapshotListItem[]
  ): RateShopSummaryDateItem {
    const hotelRow = rows.find((row) => row.competitorName === hotelName) ?? null;
    const competitorRows = rows.filter((row) => row.competitorName !== hotelName);
    const currency =
      this.pickDominantCurrency(
        competitorRows.map((row) => row.currency).filter((value): value is string => Boolean(value))
      ) ??
      hotelRow?.currency ??
      null;

    const sameCurrencyCompetitors = competitorRows.filter((row) => row.currency === currency);
    const prices = sameCurrencyCompetitors.map((row) => Number(row.price));
    const stats = this.computeMarketStats(prices);
    const yourPrice = hotelRow && hotelRow.currency === currency ? Number(hotelRow.price) : null;
    const competitorsBelowYou =
      yourPrice === null
        ? 0
        : sameCurrencyCompetitors.filter((row) => Number(row.price) < yourPrice).length;
    const cheapestCompetitor =
      sameCurrencyCompetitors.length > 0
        ? sameCurrencyCompetitors
            .map((row) => ({ name: row.competitorName, price: Number(row.price) }))
            .sort((a, b) => a.price - b.price)[0]
        : null;

    return {
      date,
      currency,
      yourPrice,
      marketAverage: stats.average,
      lowestPublicRate: stats.min,
      highestPublicRate: stats.max,
      competitorsBelowYou,
      competitorCount: sameCurrencyCompetitors.length,
      gapPct:
        yourPrice !== null && stats.average !== null && stats.average !== 0
          ? round2(((yourPrice - stats.average) / stats.average) * 100)
          : null,
      cheapestCompetitor
    };
  }
}
