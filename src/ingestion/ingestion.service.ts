import { BadRequestException, Injectable } from '@nestjs/common';
import { RecommendationAction } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';
import { AlertsService } from '../alerts/alerts.service';
import { MarketService } from '../market/market.service';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseDmyDate, parseIsoDate, parseOperaDate } from '../common/utils/date.util';
import { round2, toNumber } from '../common/utils/number.util';
import { RecommendationService } from '../recommendation/recommendation.service';

interface ReservationXmlRow {
  hotelId: number;
  reservationExternalId: string;
  bookingDate: Date;
  arrivalDate: Date;
  departureDate: Date | null;
  nights: number;
  noOfRooms: number;
  roomRate: number;
  sourceStatus: string | null;
  sourceUser: string | null;
  rawPayload: object;
}

interface HistoryForecastDailyRow {
  date: Date;
  recType: string;
  recTypeDesc: string;
  bookedRooms: number;
  occupancy: number;
  adr: number;
  revenue: number;
}

interface HistoryForecastDeltaRow {
  date: string;
  recType: string;
  status: 'new' | 'updated' | 'unchanged';
  delta: {
    bookedRooms: number;
    occupancy: number;
    adr: number;
    revenue: number;
  };
}

interface RoomRateDistributionSnapshotInput {
  criteriaStartDate: Date;
  criteriaEndDate: Date;
  criteriaWhichDate: string;
  criteriaShowGroups: string;
  criteriaCurrency: string | null;
  criteriaSections: string | null;
  criteriaChannels: string | null;
  criteriaUserLogin: string | null;
  reportExecutionTime: Date | null;
  totalReservationCount: number;
  totalRoomNights: number;
  totalRevenue: number;
  totalAdr: number;
  sourceTotalLabel: string | null;
}

@Injectable()
export class IngestionService {
  private readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
    parseTagValue: false
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsService: MetricsService,
    private readonly marketService: MarketService,
    private readonly recommendationService: RecommendationService,
    private readonly alertsService: AlertsService
  ) {}

  async deleteReservationsByArrivalRange(
    hotelId: number,
    startDate: Date,
    endDate: Date
  ): Promise<{ deleted: number; metricsRecomputedDays: number }> {
    const { count: deleted } = await this.prisma.reservationRaw.deleteMany({
      where: {
        hotelId,
        arrivalDate: {
          gte: startDate,
          lte: endDate
        }
      }
    });

    const metricsRecomputedDays = await this.metricsService.recomputeDailyMetrics(
      hotelId,
      startDate,
      endDate
    );
    await this.alertsService.syncOccupancyAlerts(hotelId, startDate, endDate);

    return { deleted, metricsRecomputedDays };
  }

  async ingestXml(fileBuffer: Buffer, fileName: string, hotelId: number) {
    const xmlText = fileBuffer.toString('utf-8');
    const parsed = this.xmlParser.parse(xmlText);

    const roomNodes = this.extractRoomNodes(parsed);
    if (roomNodes.length > 0) {
      return this.ingestReservationsXml(roomNodes, fileName, hotelId);
    }

    const historyForecastRows = this.extractHistoryForecastRows(parsed);
    if (historyForecastRows.length > 0) {
      return this.ingestHistoryForecastXml(historyForecastRows, fileName, hotelId);
    }

    const roomRateDistribution = this.extractRoomRateDistributionSnapshot(parsed);
    if (roomRateDistribution) {
      return this.ingestRoomRateDistributionSnapshot(roomRateDistribution, fileName, hotelId);
    }

    throw new BadRequestException(
      'Unsupported XML format. Expected Reservation Entered On (G_ROOM), History and Forecast, or CRS RoomRateDistribution structure.'
    );
  }

  async ingestExcel(fileBuffer: Buffer, fileName: string, hotelId: number) {
    const ingestion = await this.marketService.ingestExpediaGrid(hotelId, fileName, fileBuffer);

    if (!ingestion.dateRange) {
      return {
        source_type: 'expedia_price_grid',
        ...ingestion,
        date_range: null,
        recommendations_generated: 0,
        alerts_generated_or_updated: 0
      };
    }

    const startDate = parseIsoDate(ingestion.dateRange.start);
    const endDate = parseIsoDate(ingestion.dateRange.end);

    if (!startDate || !endDate) {
      return {
        source_type: 'expedia_price_grid',
        ...ingestion,
        date_range: ingestion.dateRange,
        recommendations_generated: 0,
        alerts_generated_or_updated: 0
      };
    }

    const recommendations = await this.recommendationService.generateAndPersistRecommendations(
      hotelId,
      startDate,
      endDate
    );
    const competitiveSetAlerts = await this.alertsService.syncCompetitiveSetAlerts(
      hotelId,
      startDate,
      endDate
    );
    const pricingOpportunityAlerts = recommendations.filter(
      (item) => item.action !== RecommendationAction.HOLD
    ).length;

    return {
      source_type: 'expedia_price_grid',
      ...ingestion,
      date_range: ingestion.dateRange,
      recommendations_generated: recommendations.length,
      pricing_opportunity_alerts_generated_or_updated: pricingOpportunityAlerts,
      competitive_set_alerts_generated_or_updated: competitiveSetAlerts,
      alerts_generated_or_updated: pricingOpportunityAlerts + competitiveSetAlerts
    };
  }

  private async ingestReservationsXml(
    roomNodes: Record<string, unknown>[],
    fileName: string,
    hotelId: number
  ) {
    const records: ReservationXmlRow[] = [];

    for (const [idx, room] of roomNodes.entries()) {
      const bookingDate = parseDmyDate(this.getString(room, 'INSERT_DATE'));
      const arrivalDate = parseDmyDate(this.getString(room, 'ARRIVAL'));
      const departureDate = parseDmyDate(this.getString(room, 'DEPARTURE'));

      if (!bookingDate || !arrivalDate) {
        continue;
      }

      const nightsRaw = toNumber(this.getString(room, 'NIGHTS'));
      const nights = Math.max(
        1,
        Math.round(nightsRaw ?? this.computeNights(arrivalDate, departureDate) ?? 1)
      );

      const noOfRoomsRaw = toNumber(this.getString(room, 'NO_OF_ROOMS'));
      const noOfRooms = Math.max(1, Math.round(noOfRoomsRaw ?? 1));

      const shareAmountPerStay = toNumber(this.getString(room, 'SHARE_AMOUNT_PER_STAY'));
      const shareAmount = toNumber(this.getString(room, 'SHARE_AMOUNT'));
      const rawRate = shareAmountPerStay ?? shareAmount ?? 0;
      const roomRate = nights > 0 ? rawRate / nights : rawRate;

      records.push({
        hotelId,
        reservationExternalId: this.getString(room, 'RESV_NAME_ID') || `${fileName}-${idx + 1}`,
        bookingDate,
        arrivalDate,
        departureDate,
        nights,
        noOfRooms,
        roomRate,
        sourceStatus: this.getString(room, 'RESV_STATUS') || null,
        sourceUser: this.getString(room, 'INSERT_USER') || null,
        rawPayload: room
      });
    }

    if (records.length === 0) {
      throw new BadRequestException(
        'XML parsed successfully but no valid reservation rows contained booking and arrival dates'
      );
    }

    let insertedCount = 0;
    const chunkSize = 1000;
    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize);
      const result = await this.prisma.reservationRaw.createMany({
        data: chunk,
        skipDuplicates: true
      });
      insertedCount += result.count;
    }

    const minArrival = records.reduce(
      (min, row) => (row.arrivalDate < min ? row.arrivalDate : min),
      records[0].arrivalDate
    );
    const maxArrival = records.reduce(
      (max, row) => (row.arrivalDate > max ? row.arrivalDate : max),
      records[0].arrivalDate
    );

    const metricsRecomputedDays = await this.metricsService.recomputeDailyMetrics(
      hotelId,
      minArrival,
      maxArrival
    );
    await this.alertsService.syncOccupancyAlerts(hotelId, minArrival, maxArrival);

    return {
      source_type: 'reservation_entered_on',
      reservations_parsed: records.length,
      reservations_inserted: insertedCount,
      metrics_recomputed_days: metricsRecomputedDays,
      date_range: {
        start: minArrival.toISOString().slice(0, 10),
        end: maxArrival.toISOString().slice(0, 10)
      }
    };
  }

  private async ingestHistoryForecastXml(
    rows: HistoryForecastDailyRow[],
    fileName: string,
    hotelId: number
  ) {
    if (rows.length === 0) {
      throw new BadRequestException(
        'No valid History and Forecast daily rows found in XML payload'
      );
    }

    const recTypePriority = new Map<string, number>([
      ['A_STAT', 1],
      ['B_FORE', 2]
    ]);

    const dedupByDate = new Map<string, HistoryForecastDailyRow>();
    for (const row of rows) {
      const key = row.date.toISOString().slice(0, 10);
      const existing = dedupByDate.get(key);
      if (!existing) {
        dedupByDate.set(key, row);
        continue;
      }

      const existingPriority = recTypePriority.get(existing.recType) ?? 0;
      const nextPriority = recTypePriority.get(row.recType) ?? 0;
      if (nextPriority >= existingPriority) {
        dedupByDate.set(key, row);
      }
    }

    const uniqueRows = [...dedupByDate.values()].sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );
    const minDate = uniqueRows[0].date;
    const maxDate = uniqueRows[uniqueRows.length - 1].date;

    const previousMetrics = await this.prisma.dailyMetrics.findMany({
      where: {
        hotelId,
        date: {
          gte: minDate,
          lte: maxDate
        }
      },
      orderBy: { date: 'asc' }
    });
    const previousByDate = new Map(
      previousMetrics.map((metric) => [metric.date.toISOString().slice(0, 10), metric])
    );

    const deltas: HistoryForecastDeltaRow[] = uniqueRows.map((row) => {
      const date = row.date.toISOString().slice(0, 10);
      const previous = previousByDate.get(date);
      if (!previous) {
        return {
          date,
          recType: row.recType,
          status: 'new',
          delta: {
            bookedRooms: row.bookedRooms,
            occupancy: row.occupancy,
            adr: row.adr,
            revenue: row.revenue
          }
        };
      }

      const delta = {
        bookedRooms: row.bookedRooms - previous.bookedRooms,
        occupancy: round2(row.occupancy - Number(previous.occupancy)),
        adr: round2(row.adr - Number(previous.adr)),
        revenue: round2(row.revenue - Number(previous.revenue))
      };

      const changed =
        delta.bookedRooms !== 0 ||
        Math.abs(delta.occupancy) > 0.01 ||
        Math.abs(delta.adr) > 0.01 ||
        Math.abs(delta.revenue) > 0.01;

      return {
        date,
        recType: row.recType,
        status: changed ? 'updated' : 'unchanged',
        delta
      };
    });

    await this.prisma.dailyMetrics.deleteMany({
      where: {
        hotelId,
        date: {
          gte: minDate,
          lte: maxDate
        }
      }
    });

    await this.prisma.dailyMetrics.createMany({
      data: uniqueRows.map((row) => ({
        hotelId,
        date: row.date,
        bookedRooms: row.bookedRooms,
        occupancy: row.occupancy,
        adr: row.adr,
        revenue: row.revenue
      }))
    });
    await this.alertsService.syncOccupancyAlerts(hotelId, minDate, maxDate);

    const historyRows = rows.filter((row) => row.recType === 'A_STAT').length;
    const forecastRows = rows.filter((row) => row.recType === 'B_FORE').length;
    const changedRows = deltas.filter((row) => row.status !== 'unchanged');
    const forecastChangedRows = changedRows.filter((row) => row.recType === 'B_FORE');
    const incrementDetected =
      forecastChangedRows.some((row) => row.delta.revenue > 0.01) ||
      forecastChangedRows.some((row) => row.delta.occupancy > 0.01) ||
      forecastChangedRows.some((row) => row.delta.bookedRooms > 0);

    return {
      source_type: 'history_forecast',
      source_file: fileName,
      rows_parsed: rows.length,
      history_rows: historyRows,
      forecast_rows: forecastRows,
      daily_metrics_upserted: uniqueRows.length,
      date_range: {
        start: minDate.toISOString().slice(0, 10),
        end: maxDate.toISOString().slice(0, 10)
      },
      changes_summary: {
        compared_against_existing_metrics: previousMetrics.length > 0,
        previous_rows_in_range: previousMetrics.length,
        new_days: deltas.filter((row) => row.status === 'new').length,
        updated_days: deltas.filter((row) => row.status === 'updated').length,
        unchanged_days: deltas.filter((row) => row.status === 'unchanged').length,
        forecast_revenue_increased_days: forecastChangedRows.filter(
          (row) => row.delta.revenue > 0.01
        ).length,
        forecast_revenue_decreased_days: forecastChangedRows.filter(
          (row) => row.delta.revenue < -0.01
        ).length,
        forecast_occupancy_increased_days: forecastChangedRows.filter(
          (row) => row.delta.occupancy > 0.01
        ).length,
        forecast_occupancy_decreased_days: forecastChangedRows.filter(
          (row) => row.delta.occupancy < -0.01
        ).length,
        increment_detected: incrementDetected
      },
      changes_preview: changedRows.slice(0, 25).map((row) => ({
        date: row.date,
        recType: row.recType,
        status: row.status,
        bookedRoomsDelta: row.delta.bookedRooms,
        occupancyDelta: row.delta.occupancy,
        adrDelta: row.delta.adr,
        revenueDelta: row.delta.revenue
      }))
    };
  }

  private async ingestRoomRateDistributionSnapshot(
    snapshot: RoomRateDistributionSnapshotInput,
    fileName: string,
    hotelId: number
  ) {
    const previous = await this.prisma.crsRoomRateDistributionSnapshot.findUnique({
      where: {
        hotelId_criteriaStartDate_criteriaEndDate_criteriaWhichDate_criteriaShowGroups: {
          hotelId,
          criteriaStartDate: snapshot.criteriaStartDate,
          criteriaEndDate: snapshot.criteriaEndDate,
          criteriaWhichDate: snapshot.criteriaWhichDate,
          criteriaShowGroups: snapshot.criteriaShowGroups
        }
      }
    });

    const persisted = await this.prisma.crsRoomRateDistributionSnapshot.upsert({
      where: {
        hotelId_criteriaStartDate_criteriaEndDate_criteriaWhichDate_criteriaShowGroups: {
          hotelId,
          criteriaStartDate: snapshot.criteriaStartDate,
          criteriaEndDate: snapshot.criteriaEndDate,
          criteriaWhichDate: snapshot.criteriaWhichDate,
          criteriaShowGroups: snapshot.criteriaShowGroups
        }
      },
      update: {
        sourceFile: fileName,
        criteriaCurrency: snapshot.criteriaCurrency,
        criteriaSections: snapshot.criteriaSections,
        criteriaChannels: snapshot.criteriaChannels,
        criteriaUserLogin: snapshot.criteriaUserLogin,
        reportExecutionTime: snapshot.reportExecutionTime,
        totalReservationCount: snapshot.totalReservationCount,
        totalRoomNights: snapshot.totalRoomNights,
        totalRevenue: snapshot.totalRevenue,
        totalAdr: snapshot.totalAdr,
        sourceTotalLabel: snapshot.sourceTotalLabel
      },
      create: {
        hotelId,
        sourceFile: fileName,
        criteriaStartDate: snapshot.criteriaStartDate,
        criteriaEndDate: snapshot.criteriaEndDate,
        criteriaWhichDate: snapshot.criteriaWhichDate,
        criteriaShowGroups: snapshot.criteriaShowGroups,
        criteriaCurrency: snapshot.criteriaCurrency,
        criteriaSections: snapshot.criteriaSections,
        criteriaChannels: snapshot.criteriaChannels,
        criteriaUserLogin: snapshot.criteriaUserLogin,
        reportExecutionTime: snapshot.reportExecutionTime,
        totalReservationCount: snapshot.totalReservationCount,
        totalRoomNights: snapshot.totalRoomNights,
        totalRevenue: snapshot.totalRevenue,
        totalAdr: snapshot.totalAdr,
        sourceTotalLabel: snapshot.sourceTotalLabel
      }
    });

    const reservationDelta = previous
      ? persisted.totalReservationCount - previous.totalReservationCount
      : persisted.totalReservationCount;
    const roomNightsDelta = previous
      ? persisted.totalRoomNights - previous.totalRoomNights
      : persisted.totalRoomNights;
    const revenueDelta = previous
      ? round2(Number(persisted.totalRevenue) - Number(previous.totalRevenue))
      : Number(persisted.totalRevenue);
    const adrDelta = previous
      ? round2(Number(persisted.totalAdr) - Number(previous.totalAdr))
      : Number(persisted.totalAdr);

    const changed =
      reservationDelta !== 0 ||
      roomNightsDelta !== 0 ||
      Math.abs(revenueDelta) > 0.01 ||
      Math.abs(adrDelta) > 0.01;

    return {
      source_type: 'crs_room_rate_distribution',
      source_file: fileName,
      criteria: {
        start_date: persisted.criteriaStartDate.toISOString().slice(0, 10),
        end_date: persisted.criteriaEndDate.toISOString().slice(0, 10),
        which_date: persisted.criteriaWhichDate,
        show_groups: persisted.criteriaShowGroups,
        currency: persisted.criteriaCurrency
      },
      totals: {
        reservations: persisted.totalReservationCount,
        room_nights: persisted.totalRoomNights,
        revenue: Number(persisted.totalRevenue),
        adr: Number(persisted.totalAdr),
        total_label: persisted.sourceTotalLabel
      },
      changes_summary: {
        compared_against_existing_snapshot: previous !== null,
        status: previous === null ? 'new' : changed ? 'updated' : 'unchanged',
        reservation_count_delta: reservationDelta,
        room_nights_delta: roomNightsDelta,
        revenue_delta: revenueDelta,
        adr_delta: adrDelta,
        increment_detected: reservationDelta > 0 || roomNightsDelta > 0 || revenueDelta > 0.01
      }
    };
  }

  private extractRoomNodes(node: unknown): Record<string, unknown>[] {
    const found: Record<string, unknown>[] = [];

    const visit = (current: unknown): void => {
      if (!current || typeof current !== 'object') {
        return;
      }

      if (Array.isArray(current)) {
        for (const item of current) {
          visit(item);
        }
        return;
      }

      const obj = current as Record<string, unknown>;
      const gRoom = obj.G_ROOM;
      if (gRoom) {
        if (Array.isArray(gRoom)) {
          for (const room of gRoom) {
            if (room && typeof room === 'object') {
              found.push(room as Record<string, unknown>);
            }
          }
        } else if (typeof gRoom === 'object') {
          found.push(gRoom as Record<string, unknown>);
        }
      }

      for (const value of Object.values(obj)) {
        visit(value);
      }
    };

    visit(node);
    return found;
  }

  private extractHistoryForecastRows(node: unknown): HistoryForecastDailyRow[] {
    const out: HistoryForecastDailyRow[] = [];

    const visit = (current: unknown): void => {
      if (!current || typeof current !== 'object') {
        return;
      }

      if (Array.isArray(current)) {
        for (const item of current) {
          visit(item);
        }
        return;
      }

      const obj = current as Record<string, unknown>;
      const recType = this.getString(obj, 'REC_TYPE');

      if (recType && obj.LIST_G_CONSIDERED_DATE && typeof obj.LIST_G_CONSIDERED_DATE === 'object') {
        const recTypeDesc = this.getString(obj, 'REC_TYPE_DESC');
        const listObj = obj.LIST_G_CONSIDERED_DATE as Record<string, unknown>;
        const dateNodes = listObj.G_CONSIDERED_DATE;
        const dateRows = Array.isArray(dateNodes)
          ? dateNodes
          : dateNodes && typeof dateNodes === 'object'
            ? [dateNodes]
            : [];

        for (const rowNode of dateRows) {
          if (!rowNode || typeof rowNode !== 'object') {
            continue;
          }

          const rowObj = rowNode as Record<string, unknown>;
          const date = this.parseHistoryForecastDate(rowObj);
          if (!date) {
            continue;
          }

          const bookedRooms = Math.max(
            0,
            Math.round(
              toNumber(this.getString(rowObj, 'CF_CALC_OCC_ROOMS')) ??
                toNumber(this.getString(rowObj, 'NO_ROOMS')) ??
                0
            )
          );
          const inventoryRooms = Math.max(
            0,
            Math.round(
              toNumber(this.getString(rowObj, 'CF_CALC_INV_ROOMS')) ??
                toNumber(this.getString(rowObj, 'INVENTORY_ROOMS')) ??
                0
            )
          );
          const revenue = toNumber(this.getString(rowObj, 'REVENUE')) ?? 0;

          const adrRaw = toNumber(this.getString(rowObj, 'CF_AVERAGE_ROOM_RATE'));
          const adr = adrRaw ?? (bookedRooms > 0 ? revenue / bookedRooms : 0);

          const occupancyRaw = toNumber(this.getString(rowObj, 'CF_OCCUPANCY'));
          const occupancy =
            occupancyRaw ?? (inventoryRooms > 0 ? (bookedRooms / inventoryRooms) * 100 : 0);

          out.push({
            date,
            recType,
            recTypeDesc,
            bookedRooms,
            occupancy: round2(occupancy),
            adr: round2(adr),
            revenue: round2(revenue)
          });
        }
      }

      for (const value of Object.values(obj)) {
        visit(value);
      }
    };

    visit(node);
    return out;
  }

  private parseHistoryForecastDate(row: Record<string, unknown>): Date | null {
    const charDate = this.getString(row, 'CHAR_CONSIDERED_DATE');
    if (charDate) {
      const firstToken = charDate.split(/\s+/)[0];
      const parsed = parseDmyDate(firstToken);
      if (parsed) {
        return parsed;
      }
    }

    const consideredDate = this.getString(row, 'CONSIDERED_DATE');
    return parseOperaDate(consideredDate) ?? parseDmyDate(consideredDate);
  }

  private extractRoomRateDistributionSnapshot(
    node: unknown
  ): RoomRateDistributionSnapshotInput | null {
    if (!node || typeof node !== 'object') {
      return null;
    }

    const root = node as Record<string, unknown>;
    const report = root.Report;
    if (!report || typeof report !== 'object') {
      return null;
    }

    const reportObj = report as Record<string, unknown>;
    if (!reportObj.Room_Rate_Distribution || typeof reportObj.Room_Rate_Distribution !== 'object') {
      return null;
    }

    const criteria = this.extractRoomRateCriteria(reportObj);
    if (!criteria) {
      return null;
    }

    const detailRows = this.collectDetailRows(reportObj.Room_Rate_Distribution);
    const totalRow = this.pickRoomRateGrandTotal(detailRows);
    if (!totalRow) {
      return null;
    }

    const reservationCount = Math.max(
      0,
      Math.round(toNumber(this.getString(totalRow, '@_Reservation_Count')) ?? 0)
    );
    const roomNights = Math.max(
      0,
      Math.round(toNumber(this.getString(totalRow, '@_Room_Nights')) ?? 0)
    );
    const revenue = round2(toNumber(this.getString(totalRow, '@_Revenue')) ?? 0);
    const adr = round2(toNumber(this.getString(totalRow, '@_ADR')) ?? 0);

    const sourceTotalLabel =
      this.getString(totalRow, '@_Report_Detail') ||
      this.getString(totalRow, '@_Rate_Type_Code') ||
      null;

    return {
      criteriaStartDate: criteria.startDate,
      criteriaEndDate: criteria.endDate,
      criteriaWhichDate: criteria.whichDate,
      criteriaShowGroups: criteria.showGroups,
      criteriaCurrency: criteria.currency,
      criteriaSections: criteria.sections,
      criteriaChannels: criteria.channels,
      criteriaUserLogin: criteria.userLogin,
      reportExecutionTime: criteria.reportExecutionTime,
      totalReservationCount: reservationCount,
      totalRoomNights: roomNights,
      totalRevenue: revenue,
      totalAdr: adr,
      sourceTotalLabel
    };
  }

  private extractRoomRateCriteria(reportObj: Record<string, unknown>): {
    startDate: Date;
    endDate: Date;
    whichDate: string;
    showGroups: string;
    currency: string | null;
    sections: string | null;
    channels: string | null;
    userLogin: string | null;
    reportExecutionTime: Date | null;
  } | null {
    const table2 = reportObj.table2;
    if (!table2 || typeof table2 !== 'object') {
      return null;
    }

    const detailCollection = (table2 as Record<string, unknown>).Detail_Collection;
    if (!detailCollection || typeof detailCollection !== 'object') {
      return null;
    }

    const details = this.toArray((detailCollection as Record<string, unknown>).Detail);
    const criteriaRaw = details.find((item): item is Record<string, unknown> => {
      return Boolean(item && typeof item === 'object');
    });

    if (!criteriaRaw) {
      return null;
    }

    const startDate = this.parseRoomRateCriteriaDate(
      this.getString(criteriaRaw, '@_Report_Criteria_StartDate')
    );
    const endDate = this.parseRoomRateCriteriaDate(
      this.getString(criteriaRaw, '@_Report_Criteria_EndDate')
    );

    if (!startDate || !endDate) {
      return null;
    }

    const whichDate = this.getString(criteriaRaw, '@_Report_Criteria_WhichDate') || 'NOT SPECIFIED';
    const showGroups =
      this.getString(criteriaRaw, '@_Report_Criteria_ShowGroups') || 'NOT SPECIFIED';
    const currency = this.getString(criteriaRaw, '@_Report_Criteria_Currency') || null;
    const sections = this.getString(criteriaRaw, '@_Report_Criteria_WhichSections') || null;
    const channels = this.getString(criteriaRaw, '@_Report_Criteria_Channels') || null;
    const userLogin = this.getString(criteriaRaw, '@_Report_Criteria_UserNameLogin') || null;
    const reportExecutionTime = this.parseRoomRateExecutionDate(
      this.getString(criteriaRaw, '@_Report_Criteria_ReportExecutionTime')
    );

    return {
      startDate,
      endDate,
      whichDate,
      showGroups,
      currency,
      sections,
      channels,
      userLogin,
      reportExecutionTime
    };
  }

  private collectDetailRows(node: unknown): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];

    const visit = (current: unknown): void => {
      if (!current || typeof current !== 'object') {
        return;
      }

      if (Array.isArray(current)) {
        for (const item of current) {
          visit(item);
        }
        return;
      }

      const obj = current as Record<string, unknown>;
      if (obj.Detail) {
        const details = this.toArray(obj.Detail);
        for (const detail of details) {
          if (detail && typeof detail === 'object') {
            out.push(detail as Record<string, unknown>);
          }
        }
      }

      for (const value of Object.values(obj)) {
        visit(value);
      }
    };

    visit(node);
    return out;
  }

  private pickRoomRateGrandTotal(
    detailRows: Record<string, unknown>[]
  ): Record<string, unknown> | null {
    if (detailRows.length === 0) {
      return null;
    }

    const totals = detailRows.filter((row) => {
      const label =
        this.getString(row, '@_Report_Detail') || this.getString(row, '@_Rate_Type_Code');
      const hasTotalLabel = /total:/i.test(label);

      const reservationCount = toNumber(this.getString(row, '@_Reservation_Count'));
      const roomNights = toNumber(this.getString(row, '@_Room_Nights'));
      const revenue = toNumber(this.getString(row, '@_Revenue'));
      const adr = toNumber(this.getString(row, '@_ADR'));

      const hasMetrics =
        reservationCount !== null && roomNights !== null && revenue !== null && adr !== null;

      return hasTotalLabel && hasMetrics;
    });

    if (totals.length === 0) {
      return null;
    }

    const preferredLabels = [
      'Rate Class Total:',
      'Rate Category Total:',
      'Rate Type Total:',
      'Room Type Total:',
      'Channel Total:',
      'Market Segment Total:'
    ];

    for (const label of preferredLabels) {
      const match = totals.find((row) => {
        const rowLabel =
          this.getString(row, '@_Report_Detail') || this.getString(row, '@_Rate_Type_Code');
        return rowLabel.toLowerCase() === label.toLowerCase();
      });

      if (match) {
        return match;
      }
    }

    return totals.sort((a, b) => {
      const aNights = toNumber(this.getString(a, '@_Room_Nights')) ?? 0;
      const bNights = toNumber(this.getString(b, '@_Room_Nights')) ?? 0;
      return bNights - aNights;
    })[0];
  }

  private parseRoomRateCriteriaDate(input: string): Date | null {
    const raw = input.trim();
    if (!raw) {
      return null;
    }

    const parsedStandard = parseDmyDate(raw) ?? parseOperaDate(raw);
    if (parsedStandard) {
      return parsedStandard;
    }

    const match = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
    if (!match) {
      return null;
    }

    const day = Number(match[1]);
    const year = Number(match[3]);
    const month = this.monthShortToNumber(match[2]);

    if (!month || Number.isNaN(day) || Number.isNaN(year)) {
      return null;
    }

    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private parseRoomRateExecutionDate(input: string): Date | null {
    const raw = input.trim();
    if (!raw) {
      return null;
    }

    const match = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+UTC$/i);
    if (!match) {
      return this.parseRoomRateCriteriaDate(raw);
    }

    const day = Number(match[1]);
    const month = this.monthShortToNumber(match[2]);
    const year = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);

    if (
      !month ||
      Number.isNaN(day) ||
      Number.isNaN(year) ||
      Number.isNaN(hour) ||
      Number.isNaN(minute)
    ) {
      return null;
    }

    const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private monthShortToNumber(month: string): number | null {
    const monthMap: Record<string, number> = {
      JAN: 1,
      FEB: 2,
      MAR: 3,
      APR: 4,
      MAY: 5,
      JUN: 6,
      JUL: 7,
      AUG: 8,
      SEP: 9,
      OCT: 10,
      NOV: 11,
      DEC: 12
    };

    return monthMap[month.trim().toUpperCase()] ?? null;
  }

  private toArray(value: unknown): unknown[] {
    if (value === null || value === undefined) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }

  private getString(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    if (value === null || value === undefined) {
      return '';
    }

    return String(value).trim();
  }

  private computeNights(arrivalDate: Date, departureDate: Date | null): number | null {
    if (!departureDate) {
      return null;
    }

    const ms = departureDate.getTime() - arrivalDate.getTime();
    const nights = Math.round(ms / (24 * 60 * 60 * 1000));
    return nights > 0 ? nights : null;
  }
}
