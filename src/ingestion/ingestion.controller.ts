import {
  BadRequestException,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  Post,
  Query,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { HotelQueryDto } from '../common/dto/hotel-query.dto';
import { HotelContextService } from '../common/hotel-context.service';
import { parseIsoDate, toUtcDateOnly } from '../common/utils/date.util';
import { IngestionService } from './ingestion.service';

@Controller('upload')
export class IngestionController {
  private readonly logger = new Logger(IngestionController.name);

  constructor(
    private readonly ingestionService: IngestionService,
    private readonly hotelContextService: HotelContextService
  ) {}

  @Post('xml')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req, file, callback) => {
        if (!/\.xml$/i.test(file.originalname)) {
          callback(
            new BadRequestException('Only XML files are supported for this endpoint'),
            false
          );
          return;
        }

        callback(null, true);
      }
    })
  )
  async uploadXml(
    @UploadedFile() file: Express.Multer.File,
    @Query() query: HotelQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Missing XML file in multipart form field "file"');
    }

    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const result = await this.runIngestion(
      () => this.ingestionService.ingestXml(file.buffer, file.originalname, hotel.id),
      file.originalname,
      hotel.id
    );

    return {
      hotel,
      source_file: file.originalname,
      ...result
    };
  }

  @Post('excel')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req, file, callback) => {
        if (!/\.(xlsx|xls)$/i.test(file.originalname)) {
          callback(
            new BadRequestException('Only Excel files are supported for this endpoint'),
            false
          );
          return;
        }

        callback(null, true);
      }
    })
  )
  async uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @Query() query: HotelQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Missing Excel file in multipart form field "file"');
    }

    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const result = await this.runIngestion(
      () => this.ingestionService.ingestExcel(file.buffer, file.originalname, hotel.id),
      file.originalname,
      hotel.id
    );

    return {
      hotel,
      source_file: file.originalname,
      ...result
    };
  }

  @Delete('reservations')
  @HttpCode(HttpStatus.OK)
  async deleteReservations(
    @Query() query: HotelQueryDto & { startDate?: string; endDate?: string },
    @CurrentUser() user: AuthenticatedUser
  ) {
    const startDate = parseIsoDate(query.startDate ?? '');
    const endDate = parseIsoDate(query.endDate ?? '');

    if (!startDate || !endDate) {
      throw new BadRequestException('startDate and endDate are required (ISO format: YYYY-MM-DD)');
    }
    if (startDate > endDate) {
      throw new BadRequestException('startDate must be before or equal to endDate');
    }

    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const result = await this.ingestionService.deleteReservationsByArrivalRange(
      hotel.id,
      toUtcDateOnly(startDate),
      toUtcDateOnly(endDate)
    );

    return {
      hotel,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
      reservations_deleted: result.deleted,
      metrics_recomputed_days: result.metricsRecomputedDays
    };
  }

  private async runIngestion<T>(
    operation: () => Promise<T>,
    fileName: string,
    hotelId: number
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Upload failed for hotel=${hotelId} file=${fileName}: ${message}`, stack);

      throw new InternalServerErrorException(
        `No fue posible procesar el archivo en el backend: ${message}`
      );
    }
  }
}
