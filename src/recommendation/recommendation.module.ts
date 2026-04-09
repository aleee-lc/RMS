import { Module } from '@nestjs/common';
import { RecommendationService } from './recommendation.service';
import { RecommendationController } from './recommendation.controller';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [AlertsModule],
  providers: [RecommendationService],
  controllers: [RecommendationController],
  exports: [RecommendationService]
})
export class RecommendationModule {}
