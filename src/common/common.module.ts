import { Global, Module } from '@nestjs/common';
import { HotelContextService } from './hotel-context.service';

@Global()
@Module({
  providers: [HotelContextService],
  exports: [HotelContextService]
})
export class CommonModule {}
