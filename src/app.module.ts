import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { MetricsModule } from './metrics/metrics.module';
import { MarketModule } from './market/market.module';
import { RecommendationModule } from './recommendation/recommendation.module';
import { AlertsModule } from './alerts/alerts.module';
import { ReportsModule } from './reports/reports.module';
import { HotelsModule } from './hotels/hotels.module';
import { CompetitorsModule } from './competitors/competitors.module';
import { RateShoppingModule } from './rate-shopping/rate-shopping.module';
import { BiModule } from './bi/bi.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommonModule,
    IngestionModule,
    MetricsModule,
    MarketModule,
    RecommendationModule,
    AlertsModule,
    ReportsModule,
    HotelsModule,
    CompetitorsModule,
    RateShoppingModule,
    BiModule
  ]
})
export class AppModule {}
