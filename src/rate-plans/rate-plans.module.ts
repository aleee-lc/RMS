import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RatePlansController } from './rate-plans.controller';
import { RatePlansService } from './rate-plans.service';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [RatePlansController],
  providers: [RatePlansService],
  exports: [RatePlansService]
})
export class RatePlansModule {}
