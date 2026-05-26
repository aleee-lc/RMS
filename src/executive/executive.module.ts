import { Module } from '@nestjs/common';
import { BiModule } from '../bi/bi.module';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportsModule } from '../reports/reports.module';
import { ExecutiveController } from './executive.controller';
import { ExecutiveService } from './executive.service';

@Module({
  imports: [PrismaModule, CommonModule, BiModule, ReportsModule],
  controllers: [ExecutiveController],
  providers: [ExecutiveService]
})
export class ExecutiveModule {}
