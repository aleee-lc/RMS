import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RateShoppingService } from './rate-shopping.service';

@Injectable()
export class RateShoppingScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateShoppingScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private lastRunDateKey: string | null = null;

  private readonly enabled =
    (process.env.RATE_SHOPPING_SCHEDULER_ENABLED ?? 'true').toLowerCase() !== 'false';
  private readonly runHourUtc = Number(process.env.RATE_SHOPPING_DAILY_HOUR_UTC ?? 5);
  private readonly runMinuteUtc = Number(process.env.RATE_SHOPPING_DAILY_MINUTE_UTC ?? 0);
  private readonly pollIntervalMs = Number(
    process.env.RATE_SHOPPING_SCHEDULER_POLL_MS ?? 15 * 60 * 1000
  );

  constructor(private readonly rateShoppingService: RateShoppingService) {}

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Rate shopping scheduler disabled by RATE_SHOPPING_SCHEDULER_ENABLED=false');
      return;
    }

    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);

    this.logger.log(
      `Rate shopping scheduler active. Next runs at ${this.runHourUtc
        .toString()
        .padStart(2, '0')}:${this.runMinuteUtc.toString().padStart(2, '0')} UTC.`
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (this.lastRunDateKey === today) {
      return;
    }
    if (now.getUTCHours() !== this.runHourUtc || now.getUTCMinutes() < this.runMinuteUtc) {
      return;
    }

    this.lastRunDateKey = today;

    try {
      const result = await this.rateShoppingService.runDailyForAllHotels();
      this.logger.log(
        `Daily rate shopping completed. Hotels processed: ${result.hotelsProcessed}.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Daily rate shopping failed: ${message}`);
    }
  }
}
