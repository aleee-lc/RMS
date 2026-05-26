import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { HotelContextService } from '../common/hotel-context.service';
import { parseIsoDate, toUtcDateOnly } from '../common/utils/date.util';
import { ExecutiveQueryDto } from './dto/executive-query.dto';
import { ExecutiveService } from './executive.service';

@Controller('executive')
export class ExecutiveController {
  constructor(
    private readonly executiveService: ExecutiveService,
    private readonly hotelContextService: HotelContextService
  ) {}

  @Get('overview')
  async getOverview(@Query() query: ExecutiveQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const range = this.resolveRange(query);
    return this.executiveService.getOverview(hotel, range.startDate, range.endDate);
  }

  @Get('financial-health')
  async getFinancialHealth(
    @Query() query: ExecutiveQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const range = this.resolveRange(query);
    return this.executiveService.getFinancialHealth(hotel, range.startDate, range.endDate);
  }

  @Get('top-risks')
  async getTopRisks(@Query() query: ExecutiveQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const range = this.resolveRange(query);
    return this.executiveService.getTopRisks(hotel, range.startDate, range.endDate);
  }

  @Get('top-opportunities')
  async getTopOpportunities(
    @Query() query: ExecutiveQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const range = this.resolveRange(query);
    return this.executiveService.getTopOpportunities(hotel, range.startDate, range.endDate);
  }

  @Get('owner-summary')
  async getOwnerSummary(
    @Query() query: ExecutiveQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const range = this.resolveRange(query);
    return this.executiveService.getOwnerSummary(hotel, range.startDate, range.endDate);
  }

  @Get('export/overview.csv')
  async exportOverviewCsv(
    @Query() query: ExecutiveQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response
  ): Promise<void> {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const range = this.resolveRange(query);
    const file = await this.executiveService.exportOverviewCsv(hotel, range.startDate, range.endDate);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }

  @Get('export/one-page.pdf')
  async exportOnePagePdf(
    @Query() query: ExecutiveQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response
  ): Promise<void> {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const range = this.resolveRange(query);
    const file = await this.executiveService.exportOnePagePdf(hotel, range.startDate, range.endDate);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }

  @Get('export/weekly-brief.pdf')
  async exportWeeklyBriefPdf(
    @Query() query: ExecutiveQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response
  ): Promise<void> {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const range = this.resolveRange(query);
    const file = await this.executiveService.exportWeeklyBriefPdf(hotel, range.startDate, range.endDate);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }

  @Get('export/board-report.pdf')
  async exportBoardReportPdf(
    @Query() query: ExecutiveQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response
  ): Promise<void> {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const range = this.resolveRange(query);
    const file = await this.executiveService.exportBoardReportPdf(hotel, range.startDate, range.endDate);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }

  private resolveRange(query: ExecutiveQueryDto): { startDate: Date; endDate: Date } {
    const today = toUtcDateOnly(new Date());
    const startDate = parseIsoDate(query.startDate) ?? today;
    const endDate =
      parseIsoDate(query.endDate) ??
      (() => {
        const date = new Date(startDate);
        date.setUTCDate(date.getUTCDate() + 29);
        return date;
      })();

    if (endDate < startDate) {
      throw new BadRequestException(
        'El rango de fechas es invalido: endDate debe ser mayor o igual a startDate.'
      );
    }

    return { startDate, endDate };
  }
}
