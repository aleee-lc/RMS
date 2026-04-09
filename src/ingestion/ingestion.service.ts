import { BadRequestException, Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { PrismaService } from '../prisma/prisma.service';
import { parseDmyDate } from '../common/utils/date.util';
import { toNumber } from '../common/utils/number.util';
import { MetricsService } from '../metrics/metrics.service';
import { MarketService } from '../market/market.service';

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
    private readonly marketService: MarketService
  ) {}

  async ingestXml(fileBuffer: Buffer, fileName: string, hotelId: number) {
    const xmlText = fileBuffer.toString('utf-8');
    const parsed = this.xmlParser.parse(xmlText);

    const roomNodes = this.extractRoomNodes(parsed);
    if (roomNodes.length === 0) {
      throw new BadRequestException('No G_ROOM nodes found in XML payload');
    }

    const records: Array<{
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
    }> = [];

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

    return {
      reservations_parsed: records.length,
      reservations_inserted: insertedCount,
      metrics_recomputed_days: metricsRecomputedDays,
      date_range: {
        start: minArrival.toISOString().slice(0, 10),
        end: maxArrival.toISOString().slice(0, 10)
      }
    };
  }

  async ingestExcel(fileBuffer: Buffer, fileName: string, hotelId: number) {
    return this.marketService.ingestExpediaGrid(hotelId, fileName, fileBuffer);
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
