import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BiController } from './bi.controller';
import { BiService } from './bi.service';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [BiController],
  providers: [BiService],
  exports: [BiService]
})
export class BiModule {}
