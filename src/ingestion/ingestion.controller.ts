import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { HotelQueryDto } from '../common/dto/hotel-query.dto';
import { HotelContextService } from '../common/hotel-context.service';
import { IngestionService } from './ingestion.service';

@Controller('upload')
export class IngestionController {
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
  async uploadXml(@UploadedFile() file: Express.Multer.File, @Query() query: HotelQueryDto) {
    if (!file?.buffer) {
      throw new BadRequestException('Missing XML file in multipart form field "file"');
    }

    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);
    const result = await this.ingestionService.ingestXml(file.buffer, file.originalname, hotel.id);

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
  async uploadExcel(@UploadedFile() file: Express.Multer.File, @Query() query: HotelQueryDto) {
    if (!file?.buffer) {
      throw new BadRequestException('Missing Excel file in multipart form field "file"');
    }

    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);
    const result = await this.ingestionService.ingestExcel(
      file.buffer,
      file.originalname,
      hotel.id
    );

    return {
      hotel,
      source_file: file.originalname,
      ...result
    };
  }
}
