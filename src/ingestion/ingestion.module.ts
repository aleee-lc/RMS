import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { MetricsModule } from '../metrics/metrics.module';
import { MarketModule } from '../market/market.module';

@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 40 * 1024 * 1024
      }
    }),
    MetricsModule,
    MarketModule
  ],
  controllers: [IngestionController],
  providers: [IngestionService]
})
export class IngestionModule {}
