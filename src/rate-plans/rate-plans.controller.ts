import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { HotelContextService } from '../common/hotel-context.service';
import { RatePlanQueryDto } from './dto/rate-plan-query.dto';
import { RatePlansService } from './rate-plans.service';

@Controller('hotels/:hotelId/rate-plans')
export class RatePlansController {
  constructor(
    private readonly ratePlansService: RatePlansService,
    private readonly hotelContextService: HotelContextService
  ) {}

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req, file, callback) => {
        if (!/\.(xlsx|xls)$/i.test(file.originalname)) {
          callback(
            new BadRequestException('Solo se permiten archivos Excel para importar el rate plan master'),
            false
          );
          return;
        }

        callback(null, true);
      }
    })
  )
  async importWorkbook(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser
  ) {
    await this.hotelContextService.resolveHotelForUser(user, hotelId);

    if (!file?.buffer) {
      throw new BadRequestException('Falta el archivo Excel en el campo multipart "file".');
    }

    return this.ratePlansService.importMasterWorkbook(hotelId, file.originalname, file.buffer);
  }

  @Get()
  async listRatePlans(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Query() query: RatePlanQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    await this.hotelContextService.resolveHotelForUser(user, hotelId);
    return this.ratePlansService.listRatePlans(hotelId, query);
  }

  @Get('insights')
  async getInsights(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @CurrentUser() user: AuthenticatedUser
  ) {
    await this.hotelContextService.resolveHotelForUser(user, hotelId);
    return this.ratePlansService.getInsights(hotelId);
  }

  @Get(':id')
  async getById(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser
  ) {
    await this.hotelContextService.resolveHotelForUser(user, hotelId);
    return this.ratePlansService.getRatePlanById(hotelId, id);
  }
}
