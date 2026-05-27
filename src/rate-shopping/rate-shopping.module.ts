import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RateShoppingController } from './rate-shopping.controller';
import { RateShoppingNormalizer } from './rate-shopping.normalizer';
import { RateShoppingScheduler } from './rate-shopping.scheduler';
import { RATE_SHOPPING_SCRAPERS, RateShoppingService } from './rate-shopping.service';
import { BookingComScraper } from './scrapers/booking-com.scraper';
import { GoogleHotelsPublicScraper } from './scrapers/google-hotels-public.scraper';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [RateShoppingController],
  providers: [
    GoogleHotelsPublicScraper,
    BookingComScraper,
    {
      provide: RATE_SHOPPING_SCRAPERS,
      useFactory: (
        googleHotelsPublicScraper: GoogleHotelsPublicScraper,
        bookingComScraper: BookingComScraper
      ) => [googleHotelsPublicScraper, bookingComScraper],
      inject: [GoogleHotelsPublicScraper, BookingComScraper]
    },
    RateShoppingNormalizer,
    RateShoppingService,
    RateShoppingScheduler
  ],
  exports: [RateShoppingService]
})
export class RateShoppingModule {}
