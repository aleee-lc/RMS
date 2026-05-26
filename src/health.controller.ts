import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  getHealth() {
    return {
      ok: true,
      service: 'rms-api',
      date: new Date().toISOString()
    };
  }
}
