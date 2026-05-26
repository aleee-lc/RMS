import { Injectable, Logger } from '@nestjs/common';
import {
  RawRateShoppingResult,
  RatePriceMode,
  RateShoppingScraper,
  RateShoppingSearchInput
} from './rate-shopping-scraper.interface';

interface ExtractedDomCandidate {
  source: string | null;
  text: string;
  priceText: string | null;
  availabilityText: string | null;
  occupancyText: string | null;
}

interface BrowserLike {
  newContext(options?: Record<string, unknown>): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface PageLike {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForTimeout(timeoutMs: number): Promise<void>;
  evaluate<T>(pageFunction: () => T): Promise<T>;
  title(): Promise<string>;
  url(): string;
}

interface PlaywrightLike {
  chromium: {
    launch(options?: Record<string, unknown>): Promise<BrowserLike>;
  };
}

const DEMO_SOURCES = ['Booking.com', 'Expedia', 'Hotels.com', 'Agoda', 'Direct'];

@Injectable()
export class GoogleHotelsPublicScraper implements RateShoppingScraper {
  readonly name = 'google-hotels-public';

  private readonly logger = new Logger(GoogleHotelsPublicScraper.name);
  private readonly navigationTimeoutMs = Number(
    process.env.RATE_SHOPPING_NAVIGATION_TIMEOUT_MS ?? 35000
  );
  private readonly settleDelayMs = Number(process.env.RATE_SHOPPING_SETTLE_DELAY_MS ?? 4000);
  private readonly demoMode = process.env.RATE_SHOPPING_DEMO_MODE === 'true';

  async scrape(input: RateShoppingSearchInput): Promise<RawRateShoppingResult[]> {
    if (this.demoMode) {
      this.logger.log(`[DEMO] Returning demo rates for "${input.targetHotelName}"`);
      return this.buildDemoResults(input);
    }

    const playwright = await this.loadPlaywright();
    const browser = await playwright.chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
        '--disable-software-rasterizer'
      ]
    });

    try {
      const context = await browser.newContext({
        viewport: { width: 1366, height: 900 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();

      try {
        const targetUrl = this.buildSearchUrl(input);
        this.logger.log(`Scraping "${input.targetHotelName}" → ${targetUrl}`);

        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: this.navigationTimeoutMs
        });
        await page.waitForTimeout(this.settleDelayMs);

        const pageTitle = await page.title();
        const finalUrl = page.url();
        this.logger.log(`Page loaded: title="${pageTitle}" url=${finalUrl}`);

        const candidates = await page.evaluate<ExtractedDomCandidate[]>(() => {
          const sourceMatchers: Array<{ regex: RegExp; label: string }> = [
            { regex: /booking\.com/i, label: 'Booking' },
            { regex: /expedia/i, label: 'Expedia' },
            { regex: /hotels\.com/i, label: 'Hotels.com' },
            { regex: /agoda/i, label: 'Agoda' },
            { regex: /trip\.com/i, label: 'Trip.com' },
            { regex: /kayak/i, label: 'Kayak' },
            { regex: /priceline/i, label: 'Priceline' },
            { regex: /official site|hotel website|direct/i, label: 'Direct' }
          ];

          const currencyRegex =
            /(MX\$\s?\d[\d.,]*)|((?:USD|MXN|EUR|GBP|CAD|JPY|BRL)\s?\d[\d.,]*)|([€$£]\s?\d[\d.,]*)/i;
          const availabilityRegex = /(sold out|unavailable|agotado|not available)/i;
          const occupancyRegex = /(\d+)\s+adult/i;

          const nodes = Array.from(document.querySelectorAll('a, article, li, div')).slice(
            0,
            2500
          );

          const out: Array<{
            source: string | null;
            text: string;
            priceText: string | null;
            availabilityText: string | null;
            occupancyText: string | null;
          }> = [];
          const seen = new Set<string>();

          for (const node of nodes) {
            const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (text.length < 24 || text.length > 420) {
              continue;
            }

            let source: string | null = null;
            for (const matcher of sourceMatchers) {
              if (matcher.regex.test(text)) {
                source = matcher.label;
                break;
              }
            }

            if (!source && node instanceof HTMLAnchorElement && node.href) {
              for (const matcher of sourceMatchers) {
                if (matcher.regex.test(node.href)) {
                  source = matcher.label;
                  break;
                }
              }
            }

            const priceMatch = text.match(currencyRegex);
            const availabilityText = availabilityRegex.test(text) ? 'unavailable' : null;
            const occupancyText = text.match(occupancyRegex)?.[0] ?? null;

            if (!source && !priceMatch && !availabilityText) {
              continue;
            }

            const dedupeKey = `${source ?? 'unknown'}|${priceMatch?.[0] ?? ''}|${availabilityText ?? ''}`;
            if (seen.has(dedupeKey)) {
              continue;
            }
            seen.add(dedupeKey);

            out.push({
              source,
              text,
              priceText: priceMatch?.[0] ?? null,
              availabilityText,
              occupancyText
            });
          }

          return out.slice(0, 80);
        });

        this.logger.log(
          `"${input.targetHotelName}": ${candidates.length} candidates found`
        );

        if (candidates.length === 0) {
          this.logger.warn(
            `No candidates for "${input.targetHotelName}". ` +
            `Google may be blocking. title="${pageTitle}". ` +
            `Set RATE_SHOPPING_DEMO_MODE=true for demo data.`
          );
        }

        return candidates
          .map((candidate) => this.toRawResult(input, candidate))
          .filter((result): result is RawRateShoppingResult => result !== null);
      } finally {
        await context.close();
      }
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.warn(`Failed scraping Google Hotels for "${input.targetHotelName}" (${input.city}): ${message}`);
      throw new Error(`Google Hotels scraping failed for "${input.targetHotelName}": ${message}`);
    } finally {
      await browser.close();
    }
  }

  private buildDemoResults(input: RateShoppingSearchInput): RawRateShoppingResult[] {
    const seed = this.nameHash(input.targetHotelName);
    const basePrice = 900 + (seed % 800);
    const now = new Date();

    return DEMO_SOURCES.map((source, index) => {
      const variation = 0.85 + ((seed * (index + 1)) % 30) / 100;
      const price = Math.round(basePrice * variation);
      return {
        hotelName: input.targetHotelName,
        source,
        price,
        currency: 'MXN',
        availability: true,
        occupancyAdults: input.adults,
        priceMode: 'per_night' as RatePriceMode,
        rawText: `${source} MXN${price} per night`,
        scrapedAt: now
      };
    });
  }

  private nameHash(name: string): number {
    let hash = 0;
    for (let index = 0; index < name.length; index++) {
      hash = ((hash << 5) - hash + name.charCodeAt(index)) | 0;
    }
    return Math.abs(hash);
  }

  private buildSearchUrl(input: RateShoppingSearchInput): string {
    const params = new URLSearchParams({
      q: `${input.targetHotelName} ${input.city}`.trim(),
      checkin: input.checkInDate.toISOString().slice(0, 10),
      checkout: input.checkOutDate.toISOString().slice(0, 10),
      adults: String(input.adults),
      hl: 'en'
    });

    return `https://www.google.com/travel/hotels?${params.toString()}`;
  }

  private toRawResult(
    input: RateShoppingSearchInput,
    candidate: ExtractedDomCandidate
  ): RawRateShoppingResult | null {
    const parsedPrice = this.extractPrice(candidate.priceText ?? candidate.text);
    const occupancy = this.extractAdults(candidate.occupancyText);
    const lowerText = candidate.text.toLowerCase();

    const inferredAvailability =
      candidate.availabilityText === 'unavailable'
        ? false
        : /available|book now|reserve/i.test(lowerText)
          ? true
          : null;

    const priceMode = this.inferPriceMode(candidate.text);
    const source = candidate.source ?? 'Google Hotels';

    return {
      hotelName: input.targetHotelName,
      source,
      price: parsedPrice?.price ?? null,
      currency: parsedPrice?.currency ?? null,
      availability: inferredAvailability,
      occupancyAdults: occupancy ?? input.adults,
      priceMode,
      rawText: candidate.text,
      scrapedAt: new Date()
    };
  }

  private extractAdults(text: string | null): number | null {
    if (!text) {
      return null;
    }

    const match = text.match(/(\d+)\s+adult/i);
    if (!match) {
      return null;
    }

    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 1) {
      return null;
    }

    return Math.round(value);
  }

  private inferPriceMode(text: string): RatePriceMode {
    const normalized = text.toLowerCase();
    if (/total|for \d+\s+night|for stay|trip total/.test(normalized)) {
      return 'total_stay';
    }
    if (/per night|nightly/.test(normalized)) {
      return 'per_night';
    }
    return 'unknown';
  }

  private extractPrice(text: string): { price: number; currency: string } | null {
    // MX$ (Google Hotels Mexico format) → MXN
    const mxnMatch = text.match(/MX\$\s*([\d.,]+)/i);
    if (mxnMatch) {
      const value = this.parseNumber(mxnMatch[1]);
      if (value !== null) return { price: value, currency: 'MXN' };
    }

    // Explicit currency codes: MXN 1665, USD 40, etc.
    const currencyCodeMatch = text.match(/\b(USD|MXN|EUR|GBP|CAD|JPY|BRL)\s*([\d.,]+)\b/i);
    if (currencyCodeMatch) {
      const value = this.parseNumber(currencyCodeMatch[2]);
      if (value !== null) {
        return { price: value, currency: currencyCodeMatch[1].toUpperCase() };
      }
    }

    // Generic symbol fallback: €, £ (not $ alone — too ambiguous for MX context)
    const symbolMatch = text.match(/([€£])\s*([\d.,]+)/);
    if (symbolMatch) {
      const value = this.parseNumber(symbolMatch[2]);
      const symbolCurrency: Record<string, string> = { '€': 'EUR', '£': 'GBP' };
      if (value !== null) {
        return { price: value, currency: symbolCurrency[symbolMatch[1]] ?? 'EUR' };
      }
    }

    return null;
  }

  private parseNumber(value: string): number | null {
    const clean = value.replace(/[^\d.,]/g, '');
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

  private async loadPlaywright(): Promise<PlaywrightLike> {
    try {
      const dynamicImport = new Function(
        'moduleName',
        'return import(moduleName);'
      ) as (moduleName: string) => Promise<unknown>;

      const moduleValue = (await dynamicImport('playwright')) as Partial<PlaywrightLike>;
      if (!moduleValue.chromium) {
        throw new Error('playwright module does not expose chromium');
      }

      return moduleValue as PlaywrightLike;
    } catch (error) {
      throw new Error(
        `Playwright is required for rate shopping. Install it with "npm install playwright". Root cause: ${this.errorMessage(error)}`
      );
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
