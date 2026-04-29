import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RateShoppingController } from './rate-shopping.controller';
import { RateShoppingNormalizer } from './rate-shopping.normalizer';
import { RateShoppingScheduler } from './rate-shopping.scheduler';
import { RATE_SHOPPING_SCRAPERS, RateShoppingService } from './rate-shopping.service';
import { GoogleHotelsPublicScraper } from './scrapers/google-hotels-public.scraper';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [RateShoppingController],
  providers: [
    GoogleHotelsPublicScraper,
    {
      provide: RATE_SHOPPING_SCRAPERS,
      useFactory: (googleHotelsPublicScraper: GoogleHotelsPublicScraper) => [
        googleHotelsPublicScraper
      ],
      inject: [GoogleHotelsPublicScraper]
    },
    RateShoppingNormalizer,
    RateShoppingService,
    RateShoppingScheduler
  ],
  exports: [RateShoppingService]
})
export class RateShoppingModule {}
