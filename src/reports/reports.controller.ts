import { Controller, Get, Query } from '@nestjs/common';
import { HotelContextService } from '../common/hotel-context.service';
import { parseIsoDate } from '../common/utils/date.util';
import { CrsReconciliationQueryDto } from './dto/crs-reconciliation-query.dto';
import { PickupReportQueryDto } from './dto/pickup-report-query.dto';
import { RecommendationComplianceQueryDto } from './dto/recommendation-compliance-query.dto';
import { ReportDateRangeQueryDto } from './dto/report-date-range-query.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly hotelContextService: HotelContextService
  ) {}

  @Get('pickup')
  async getPickupReport(@Query() query: PickupReportQueryDto) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);

    const defaultBooking = this.reportsService.defaultPastRange(6);
    const defaultStay = this.reportsService.defaultFutureRange(120);

    const bookingRange = {
      startDate: parseIsoDate(query.bookingStartDate) ?? defaultBooking.startDate,
      endDate: parseIsoDate(query.bookingEndDate) ?? defaultBooking.endDate
    };

    const stayRange = {
      startDate: parseIsoDate(query.stayStartDate) ?? defaultStay.startDate,
      endDate: parseIsoDate(query.stayEndDate) ?? defaultStay.endDate
    };

    const report = await this.reportsService.getPickupReport(hotel.id, bookingRange, stayRange);

    return {
      hotel,
      ...report
    };
  }

  @Get('forecast-variance')
  async getForecastVarianceReport(@Query() query: ReportDateRangeQueryDto) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);
    const defaultRange = this.reportsService.defaultFutureRange(90);
    const range = {
      startDate: parseIsoDate(query.startDate) ?? defaultRange.startDate,
      endDate: parseIsoDate(query.endDate) ?? defaultRange.endDate
    };

    const report = await this.reportsService.getForecastVarianceReport(hotel.id, range);

    return {
      hotel,
      ...report
    };
  }

  @Get('market-position')
  async getMarketPositionReport(@Query() query: ReportDateRangeQueryDto) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);
    const defaultRange = this.reportsService.defaultFutureRange(90);
    const range = {
      startDate: parseIsoDate(query.startDate) ?? defaultRange.startDate,
      endDate: parseIsoDate(query.endDate) ?? defaultRange.endDate
    };

    const report = await this.reportsService.getMarketPositionReport(hotel.id, range);

    return {
      hotel,
      ...report
    };
  }

  @Get('recommendation-compliance')
  async getRecommendationComplianceReport(@Query() query: RecommendationComplianceQueryDto) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);
    const defaultRange = this.reportsService.defaultFutureRange(60);
    const range = {
      startDate: parseIsoDate(query.startDate) ?? defaultRange.startDate,
      endDate: parseIsoDate(query.endDate) ?? defaultRange.endDate
    };
    const tolerancePct = Number(query.tolerancePct ?? 2);

    const report = await this.reportsService.getRecommendationComplianceReport(
      hotel.id,
      range,
      tolerancePct
    );

    return {
      hotel,
      ...report
    };
  }

  @Get('revenue-opportunity')
  async getRevenueOpportunityReport(@Query() query: ReportDateRangeQueryDto) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);
    const defaultRange = this.reportsService.defaultFutureRange(60);
    const range = {
      startDate: parseIsoDate(query.startDate) ?? defaultRange.startDate,
      endDate: parseIsoDate(query.endDate) ?? defaultRange.endDate
    };

    const report = await this.reportsService.getRevenueOpportunityReport(hotel.id, range);

    return {
      hotel,
      ...report
    };
  }

  @Get('executive-summary')
  async getExecutiveSummaryReport(@Query() query: ReportDateRangeQueryDto) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);
    const defaultRange = this.reportsService.defaultFutureRange(60);
    const range = {
      startDate: parseIsoDate(query.startDate) ?? defaultRange.startDate,
      endDate: parseIsoDate(query.endDate) ?? defaultRange.endDate
    };

    const report = await this.reportsService.getExecutiveSummaryReport(hotel.id, range);

    return {
      hotel,
      ...report
    };
  }

  @Get('crs-reconciliation')
  async getCrsReconciliationReport(@Query() query: CrsReconciliationQueryDto) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);
    const report = await this.reportsService.getCrsReconciliationReport(hotel.id, {
      startDate: parseIsoDate(query.startDate) ?? undefined,
      endDate: parseIsoDate(query.endDate) ?? undefined,
      whichDate: query.whichDate
    });

    return {
      hotel,
      ...report
    };
  }
}
