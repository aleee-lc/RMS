import { Injectable, Logger } from '@nestjs/common';
import {
  RawRateShoppingResult,
  RatePriceMode,
  RateShoppingScraper,
  RateShoppingSearchInput
} from './rate-shopping-scraper.interface';

interface HotelCard {
  name: string;
  priceText: string;
  soldOut: boolean;
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
}

interface PlaywrightLike {
  chromium: {
    launch(options?: Record<string, unknown>): Promise<BrowserLike>;
  };
}

@Injectable()
export class BookingComScraper implements RateShoppingScraper {
  readonly name = 'booking-com';

  private readonly logger = new Logger(BookingComScraper.name);
  private readonly navigationTimeoutMs = Number(
    process.env.RATE_SHOPPING_NAVIGATION_TIMEOUT_MS ?? 35000
  );
  private readonly settleDelayMs = Number(process.env.RATE_SHOPPING_SETTLE_DELAY_MS ?? 5000);

  async scrape(input: RateShoppingSearchInput): Promise<RawRateShoppingResult[]> {
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
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'en-US'
      });
      const page = await context.newPage();

      try {
        const targetUrl = this.buildSearchUrl(input);
        this.logger.log(`[Booking.com] Scraping "${input.targetHotelName}" → ${targetUrl}`);

        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: this.navigationTimeoutMs
        });
        await page.waitForTimeout(this.settleDelayMs);

        const pageTitle = await page.title();
        this.logger.log(`[Booking.com] Page loaded: title="${pageTitle}"`);

        const cards = await page.evaluate<HotelCard[]>(() => {
          const out: HotelCard[] = [];

          // Primary: Booking.com property cards (React-rendered, data-testid attributes)
          const cardEls = Array.from(document.querySelectorAll('[data-testid="property-card"]'));

          for (const card of cardEls) {
            const nameEl = card.querySelector('[data-testid="title"]');
            const name = nameEl?.textContent?.trim() ?? '';
            if (!name) continue;

            const priceEl =
              card.querySelector('[data-testid="price-and-discounted-price"]') ??
              card.querySelector('[data-testid="price"]') ??
              card.querySelector('[class*="prco-inline-block-maker-helper"]') ??
              card.querySelector('[class*="bui-price"]');

            const priceText = priceEl?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
            const cardText = card.textContent ?? '';
            const soldOut = /sold out|no availability|no rooms available/i.test(cardText);

            out.push({ name, priceText, soldOut });
          }

          // Fallback: older Booking.com markup uses sr_item / sr-hotel__name
          if (out.length === 0) {
            const nameEls = Array.from(
              document.querySelectorAll('.sr-hotel__name, [class*="hotel-name"]')
            );
            for (const nameEl of nameEls) {
              const name = nameEl.textContent?.trim() ?? '';
              if (!name) continue;
              const parent = nameEl.closest(
                '[class*="sr_item"], [class*="hotel-item"], [class*="property"]'
              );
              const priceEl = parent?.querySelector('[class*="price_wrapper"], [class*="bui-price"]');
              const priceText = priceEl?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
              out.push({ name, priceText, soldOut: false });
            }
          }

          return out.slice(0, 15);
        });

        this.logger.log(
          `[Booking.com] "${input.targetHotelName}": ${cards.length} cards found`
        );

        if (cards.length === 0) {
          this.logger.warn(
            `[Booking.com] No cards for "${input.targetHotelName}". title="${pageTitle}"`
          );
          return [];
        }

        const matched = this.findBestMatch(input.targetHotelName, cards);
        if (!matched) {
          this.logger.warn(`[Booking.com] No name match for "${input.targetHotelName}"`);
          return [];
        }

        this.logger.log(
          `[Booking.com] Matched "${matched.name}" priceText="${matched.priceText}"`
        );

        const parsedPrice = this.extractPrice(matched.priceText);
        if (!parsedPrice) {
          this.logger.warn(
            `[Booking.com] Could not parse price from "${matched.priceText}" for "${input.targetHotelName}"`
          );
          return [];
        }

        return [
          {
            hotelName: input.targetHotelName,
            source: 'Booking.com',
            price: parsedPrice.price,
            currency: parsedPrice.currency,
            availability: matched.soldOut ? false : true,
            occupancyAdults: input.adults,
            priceMode: 'per_night' as RatePriceMode,
            rawText: matched.priceText,
            scrapedAt: new Date()
          }
        ];
      } finally {
        await context.close();
      }
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.warn(`[Booking.com] Failed for "${input.targetHotelName}": ${message}`);
      throw new Error(`Booking.com scraping failed for "${input.targetHotelName}": ${message}`);
    } finally {
      await browser.close();
    }
  }

  private buildSearchUrl(input: RateShoppingSearchInput): string {
    const params = new URLSearchParams({
      ss: `${input.targetHotelName} ${input.city}`.trim(),
      checkin: input.checkInDate.toISOString().slice(0, 10),
      checkout: input.checkOutDate.toISOString().slice(0, 10),
      group_adults: String(input.adults),
      no_rooms: '1',
      selected_currency: 'MXN',
      lang: 'en-us'
    });
    return `https://www.booking.com/searchresults.html?${params.toString()}`;
  }

  private findBestMatch(targetName: string, cards: HotelCard[]): HotelCard | null {
    if (cards.length === 0) return null;

    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const targetTokens = normalize(targetName)
      .split(' ')
      .filter((t) => t.length > 2);

    let bestCard: HotelCard | null = cards[0];
    let bestScore = -1;

    for (const card of cards) {
      const cardNorm = normalize(card.name);
      let score = 0;
      for (const token of targetTokens) {
        if (cardNorm.includes(token)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestCard = card;
      }
    }

    return bestCard;
  }

  private extractPrice(text: string): { price: number; currency: string } | null {
    if (!text) return null;

    const mxnMatch = text.match(/MX\$\s*([\d.,]+)/i);
    if (mxnMatch) {
      const value = this.parseNumber(mxnMatch[1]);
      if (value !== null) return { price: value, currency: 'MXN' };
    }

    const codeMatch = text.match(/\b(MXN|USD|EUR|GBP)\s*([\d.,]+)/i);
    if (codeMatch) {
      const value = this.parseNumber(codeMatch[2]);
      if (value !== null) return { price: value, currency: codeMatch[1].toUpperCase() };
    }

    // Booking.com sometimes shows the number without explicit currency (currency shown elsewhere)
    // Only accept if it looks like a room price (hundreds to tens of thousands)
    const plainMatch = text.match(/\b([\d]{1,3}(?:[,.][\d]{3})*(?:[.,][\d]{2})?)\b/);
    if (plainMatch) {
      const value = this.parseNumber(plainMatch[1]);
      if (value !== null && value >= 200 && value <= 100000) {
        return { price: value, currency: 'MXN' };
      }
    }

    return null;
  }

  private parseNumber(value: string): number | null {
    const clean = value.replace(/[^\d.,]/g, '');
    if (!clean) return null;

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
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
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
        `Playwright is required for rate shopping. Root cause: ${this.errorMessage(error)}`
      );
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
