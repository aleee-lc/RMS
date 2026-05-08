import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { MetricsModule } from '../metrics/metrics.module';
import { MarketModule } from '../market/market.module';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 40 * 1024 * 1024
      }
    }),
    MetricsModule,
    MarketModule,
    RecommendationModule,
    AlertsModule
  ],
  controllers: [IngestionController],
  providers: [IngestionService]
})
export class IngestionModule {}
