import { Injectable } from '@nestjs/common';
import { Hotel } from '@prisma/client';
import { clamp, round2 } from '../common/utils/number.util';
import { dateKey, enumerateDateRange, toUtcDateOnly } from '../common/utils/date.util';
import { PrismaService } from '../prisma/prisma.service';

type BiSeverity = 'low' | 'medium' | 'high';
type BiRecommendationAction =
  | 'increase-slightly'
  | 'increase-aggressively'
  | 'hold'
  | 'review-promotion'
  | 'decrease-moderately'
  | 'investigate-low-demand'
  | 'monitor-competition';

interface PickupAggregate {
  rooms1d: number;
  rooms3d: number;
  rooms7d: number;
  rooms14d: number;
  roomNights7d: number;
  revenue7d: number;
  adr7d: number;
  accelerated: boolean;
}

interface MarketAggregate {
  yourPrice: number | null;
  marketAverage: number | null;
  gapAmount: number | null;
  gapPct: number | null;
  position: 'below' | 'above' | 'aligned' | 'unknown';
  rank: number | null;
  rankTotal: number;
  cheapestCompetitor: { name: string; price: number } | null;
  mostExpensiveCompetitor: { name: string; price: number } | null;
  aggressiveDrops: Array<{ competitor: string; changePct: number }>;
}

type BiHotel = Pick<Hotel, 'id' | 'name' | 'totalRooms'>;
type BiExportHotel = Pick<Hotel, 'id' | 'name' | 'totalRooms'> & { currency?: string };

export interface BiSignal {
  type: string;
  title: string;
  severity: BiSeverity;
  message: string;
}

export interface BiRecommendation {
  action: BiRecommendationAction;
  label: string;
  severity: BiSeverity;
  score: number;
  reason: string;
  evidence: string[];
  estimatedImpact: number;
}

export interface RevenueCalendarItem {
  date: string;
  daysToArrival: number;
  occupancy: number | null;
  bookedRooms: number | null;
  adr: number | null;
  revenue: number | null;
  pickup: PickupAggregate;
  market: MarketAggregate;
  opportunityScore: number;
  riskScore: number;
  suggestedAction: BiRecommendationAction;
  recommendation: BiRecommendation;
  signals: BiSignal[];
}

export interface BiExportFile {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

@Injectable()
export class BiService {
  private readonly highOccupancyThreshold = 70;
  private readonly lowOccupancyThreshold = 30;
  private readonly criticalOccupancyThreshold = 20;
  private readonly significantGapPct = 5;

  constructor(private readonly prisma: PrismaService) {}

  async getRevenueCalendar(
    hotel: Pick<Hotel, 'id' | 'totalRooms'>,
    startDate: Date,
    endDate: Date,
    now = new Date()
  ): Promise<RevenueCalendarItem[]> {
    const normalizedStart = toUtcDateOnly(startDate);
    const normalizedEnd = toUtcDateOnly(endDate);
    const today = toUtcDateOnly(now);
    const pickupStart = new Date(today);
    pickupStart.setUTCDate(pickupStart.getUTCDate() - 13);
    const trendStart = new Date(normalizedStart);
    trendStart.setUTCDate(trendStart.getUTCDate() - 1);

    const [metrics, reservations, marketRates] = await Promise.all([
      this.prisma.dailyMetrics.findMany({
        where: {
          hotelId: hotel.id,
          date: {
            gte: normalizedStart,
            lte: normalizedEnd
          }
        }
      }),
      this.prisma.reservationRaw.findMany({
        where: {
          hotelId: hotel.id,
          arrivalDate: {
            gte: normalizedStart,
            lte: normalizedEnd
          },
          bookingDate: {
            gte: pickupStart,
            lte: today
          }
        }
      }),
      this.prisma.marketRates.findMany({
        where: {
          hotelId: hotel.id,
          date: {
            gte: trendStart,
            lte: normalizedEnd
          }
        },
        include: {
          competitorRates: {
            include: {
              competitor: true
            }
          }
        }
      })
    ]);

    const metricsByDate = new Map(metrics.map((metric) => [dateKey(metric.date), metric]));
    const pickupByDate = this.aggregatePickup(reservations, today);
    const marketByDate = this.aggregateMarket(marketRates);

    return enumerateDateRange(normalizedStart, normalizedEnd).map((date) => {
      const key = dateKey(date);
      const metric = metricsByDate.get(key);
      const pickup = pickupByDate.get(key) ?? this.emptyPickup();
      const market = marketByDate.get(key) ?? this.emptyMarket();
      const occupancy = metric ? Number(metric.occupancy) : null;
      const adr = metric ? Number(metric.adr) : null;
      const revenue = metric ? Number(metric.revenue) : null;
      const bookedRooms = metric?.bookedRooms ?? null;
      const daysToArrival = Math.max(
        0,
        Math.round((date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
      );
      const opportunityScore = this.scoreOpportunity({
        occupancy,
        pickup,
        market,
        daysToArrival,
        hotelRooms: hotel.totalRooms
      });
      const riskScore = this.scoreRisk({
        occupancy,
        pickup,
        market,
        daysToArrival
      });
      const signals = this.buildSignals({ occupancy, pickup, market, daysToArrival });
      const recommendation = this.buildRecommendation({
        occupancy,
        pickup,
        market,
        opportunityScore,
        riskScore,
        adr,
        hotelRooms: hotel.totalRooms
      });

      return {
        date: key,
        daysToArrival,
        occupancy: occupancy === null ? null : round2(occupancy),
        bookedRooms,
        adr: adr === null ? null : round2(adr),
        revenue: revenue === null ? null : round2(revenue),
        pickup,
        market,
        opportunityScore,
        riskScore,
        suggestedAction: recommendation.action,
        recommendation,
        signals
      };
    });
  }

  async getExecutiveSummary(hotel: BiHotel, startDate: Date, endDate: Date) {
    const rows = await this.getRevenueCalendar(hotel, startDate, endDate);
    const activeAlerts = await this.prisma.alerts.count({
      where: {
        hotelId: hotel.id,
        resolved: false,
        date: {
          gte: toUtcDateOnly(startDate),
          lte: toUtcDateOnly(endDate)
        }
      }
    });

    const metricRows = rows.filter((row) => row.occupancy !== null);
    const avgOccupancy = this.average(metricRows.map((row) => row.occupancy ?? 0));
    const avgAdr = this.average(metricRows.map((row) => row.adr ?? 0));
    const totalRevenue = metricRows.reduce((sum, row) => sum + (row.revenue ?? 0), 0);
    const highOccupancyDates = rows.filter(
      (row) => (row.occupancy ?? 0) >= this.highOccupancyThreshold
    );
    const lowOccupancyDates = rows.filter(
      (row) => row.occupancy !== null && row.occupancy <= this.criticalOccupancyThreshold
    );
    const belowCompSetDates = rows.filter((row) => row.market.position === 'below');
    const aboveCompSetDates = rows.filter((row) => row.market.position === 'above');

    return {
      hotel: {
        id: hotel.id,
        name: hotel.name,
        totalRooms: hotel.totalRooms
      },
      date_range: {
        start: toUtcDateOnly(startDate).toISOString().slice(0, 10),
        end: toUtcDateOnly(endDate).toISOString().slice(0, 10)
      },
      kpis: {
        avg_occupancy: round2(avgOccupancy),
        avg_adr: round2(avgAdr),
        total_revenue: round2(totalRevenue),
        active_alerts: activeAlerts,
        high_occupancy_dates: highOccupancyDates.length,
        extremely_low_dates: lowOccupancyDates.length,
        below_comp_set_dates: belowCompSetDates.length,
        above_comp_set_dates: aboveCompSetDates.length
      },
      top_pickup: this.sortDesc(rows, (row) => row.pickup.rooms7d).slice(0, 8),
      top_opportunities: this.sortDesc(rows, (row) => row.opportunityScore).slice(0, 8),
      top_risks: this.sortDesc(rows, (row) => row.riskScore).slice(0, 8),
      high_occupancy_dates: highOccupancyDates.slice(0, 12),
      extremely_low_dates: lowOccupancyDates.slice(0, 12),
      below_comp_set_dates: belowCompSetDates.slice(0, 12),
      above_comp_set_dates: aboveCompSetDates.slice(0, 12)
    };
  }

  async getPickupIntelligence(hotel: BiHotel, startDate: Date, endDate: Date) {
    const rows = await this.getRevenueCalendar(hotel, startDate, endDate);
    return {
      hotel: this.hotelSummary(hotel),
      count: rows.length,
      items: rows.map((row) => ({
        date: row.date,
        occupancy: row.occupancy,
        pickup: row.pickup,
        signals: row.signals.filter((signal) =>
          ['accelerated-demand', 'fast-filling-date', 'no-recent-pickup'].includes(signal.type)
        )
      })),
      top_pickup: this.sortDesc(rows, (row) => row.pickup.rooms7d).slice(0, 10),
      no_recent_pickup: rows.filter((row) => row.pickup.rooms7d === 0).slice(0, 15)
    };
  }

  async getForecastIntelligence(hotel: BiHotel, startDate: Date, endDate: Date) {
    const rows = await this.getRevenueCalendar(hotel, startDate, endDate);
    return {
      hotel: this.hotelSummary(hotel),
      count: rows.length,
      items: rows.map((row) => ({
        date: row.date,
        occupancy: row.occupancy,
        bookedRooms: row.bookedRooms,
        adr: row.adr,
        revenue: row.revenue,
        signals: row.signals.filter((signal) =>
          ['fast-filling-date', 'extremely-low-demand', 'low-demand-risk'].includes(signal.type)
        )
      })),
      high_demand: rows
        .filter((row) => (row.occupancy ?? 0) >= this.highOccupancyThreshold)
        .slice(0, 15),
      low_demand: rows
        .filter((row) => row.occupancy !== null && row.occupancy <= this.criticalOccupancyThreshold)
        .slice(0, 15)
    };
  }

  async getCompSetIntelligence(hotel: BiHotel, startDate: Date, endDate: Date) {
    const rows = await this.getRevenueCalendar(hotel, startDate, endDate);
    return {
      hotel: this.hotelSummary(hotel),
      count: rows.length,
      items: rows.map((row) => ({
        date: row.date,
        occupancy: row.occupancy,
        pickup7d: row.pickup.rooms7d,
        market: row.market,
        signals: row.signals.filter((signal) =>
          [
            'price-below-comp-set',
            'price-above-comp-set',
            'high-demand-low-price',
            'low-demand-high-price',
            'competitor-aggressive-drop'
          ].includes(signal.type)
        )
      })),
      below_comp_set: rows.filter((row) => row.market.position === 'below').slice(0, 15),
      above_comp_set: rows.filter((row) => row.market.position === 'above').slice(0, 15)
    };
  }

  async exportRevenueCalendarCsv(
    hotel: BiExportHotel,
    startDate: Date,
    endDate: Date
  ): Promise<BiExportFile> {
    const rows = await this.getRevenueCalendar(hotel, startDate, endDate);
    const range = this.exportRange(startDate, endDate);
    const headers = [
      'Fecha',
      'Dia de semana',
      'Dias a llegada',
      'Ocupacion %',
      'Pickup 7d',
      'ADR',
      'Revenue',
      'Tarifa propia',
      'Comp set promedio',
      'Gap %',
      'Ranking',
      'Opportunity Score',
      'Risk Score',
      'Accion sugerida',
      'Senales / alertas'
    ];
    const lines = [
      headers.map((header) => this.csvCell(header)).join(','),
      ...rows.map((row) =>
        [
          row.date,
          this.dayOfWeek(row.date),
          row.daysToArrival,
          this.csvNumber(row.occupancy),
          row.pickup.rooms7d,
          this.csvNumber(row.adr),
          this.csvNumber(row.revenue),
          this.csvNumber(row.market.yourPrice),
          this.csvNumber(row.market.marketAverage),
          this.csvNumber(row.market.gapPct),
          row.market.rank ? `${row.market.rank}/${row.market.rankTotal}` : '',
          row.opportunityScore,
          row.riskScore,
          row.recommendation.label,
          row.signals.map((signal) => signal.title).join(' | ')
        ]
          .map((value) => this.csvCell(value))
          .join(',')
      )
    ];

    return {
      filename: `revenue-intelligence-${range.start}_a_${range.end}.csv`,
      contentType: 'text/csv; charset=utf-8',
      buffer: Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8')
    };
  }

  async exportRevenueCalendarPdf(
    hotel: BiExportHotel,
    startDate: Date,
    endDate: Date
  ): Promise<BiExportFile> {
    const [summary, rows] = await Promise.all([
      this.getExecutiveSummary(hotel, startDate, endDate),
      this.getRevenueCalendar(hotel, startDate, endDate)
    ]);
    const range = this.exportRange(startDate, endDate);
    const generatedAt = new Date().toLocaleString('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Chihuahua'
    });
    const pdf = this.buildRevenueReportPdf({
      hotel,
      range,
      generatedAt,
      summary,
      rows
    });

    return {
      filename: `revenue-intelligence-${range.start}_a_${range.end}.pdf`,
      contentType: 'application/pdf',
      buffer: pdf
    };
  }

  private aggregatePickup(reservations: any[], today: Date): Map<string, PickupAggregate> {
    const grouped = new Map<string, any[]>();
    for (const reservation of reservations) {
      const key = dateKey(reservation.arrivalDate);
      grouped.set(key, [...(grouped.get(key) ?? []), reservation]);
    }

    return new Map(
      [...grouped.entries()].map(([key, rows]) => [key, this.buildPickupAggregate(rows, today)])
    );
  }

  private buildPickupAggregate(reservations: any[], today: Date): PickupAggregate {
    const totals = {
      rooms1d: 0,
      rooms3d: 0,
      rooms7d: 0,
      rooms14d: 0,
      roomNights7d: 0,
      revenue7d: 0
    };

    for (const reservation of reservations) {
      const ageDays = Math.max(
        0,
        Math.round((today.getTime() - toUtcDateOnly(reservation.bookingDate).getTime()) / 86400000)
      );
      const rooms = Number(reservation.noOfRooms ?? 0);
      const nights = Number(reservation.nights ?? 1);
      const revenue = Number(reservation.roomRate ?? 0) * nights * rooms;

      if (ageDays <= 0) totals.rooms1d += rooms;
      if (ageDays <= 2) totals.rooms3d += rooms;
      if (ageDays <= 6) {
        totals.rooms7d += rooms;
        totals.roomNights7d += rooms * nights;
        totals.revenue7d += revenue;
      }
      if (ageDays <= 13) totals.rooms14d += rooms;
    }

    const previous7dRooms = Math.max(0, totals.rooms14d - totals.rooms7d);

    return {
      ...totals,
      revenue7d: round2(totals.revenue7d),
      adr7d: totals.roomNights7d > 0 ? round2(totals.revenue7d / totals.roomNights7d) : 0,
      accelerated: totals.rooms7d >= Math.max(3, previous7dRooms * 1.5)
    };
  }

  private aggregateMarket(marketRates: any[]): Map<string, MarketAggregate> {
    const sorted = [...marketRates].sort((a, b) => a.date.getTime() - b.date.getTime());
    const previousPriceByCompetitor = new Map<number, number>();
    const output = new Map<string, MarketAggregate>();

    for (const rate of sorted) {
      const competitorPrices = (rate.competitorRates ?? [])
        .map((entry: any) => ({
          competitorId: entry.competitorId,
          name: entry.competitor?.name ?? `Competidor ${entry.competitorId}`,
          price: Number(entry.price ?? 0)
        }))
        .filter((entry: any) => entry.price > 0);
      const aggressiveDrops: Array<{ competitor: string; changePct: number }> = [];

      for (const entry of competitorPrices) {
        const previous = previousPriceByCompetitor.get(entry.competitorId);
        if (previous && previous > 0) {
          const changePct = ((entry.price - previous) / previous) * 100;
          if (changePct <= -5) {
            aggressiveDrops.push({
              competitor: entry.name,
              changePct: round2(changePct)
            });
          }
        }
        previousPriceByCompetitor.set(entry.competitorId, entry.price);
      }

      const yourPrice = Number(rate.yourPrice ?? 0) || null;
      const inferredAverage = this.average(competitorPrices.map((entry: any) => entry.price));
      const marketAverage = Number(rate.marketAverage ?? 0) || inferredAverage || null;
      const sortedCompetitors = [...competitorPrices].sort((a: any, b: any) => a.price - b.price);
      const cheapestCompetitor = sortedCompetitors[0]
        ? { name: sortedCompetitors[0].name, price: round2(sortedCompetitors[0].price) }
        : null;
      const mostExpensiveCompetitor = sortedCompetitors[sortedCompetitors.length - 1]
        ? {
            name: sortedCompetitors[sortedCompetitors.length - 1].name,
            price: round2(sortedCompetitors[sortedCompetitors.length - 1].price)
          }
        : null;
      const rankingPrices = yourPrice
        ? [...competitorPrices.map((entry: any) => entry.price), yourPrice].sort((a, b) => a - b)
        : [];
      const rank = yourPrice ? rankingPrices.findIndex((price) => price >= yourPrice) + 1 : null;
      const gapAmount = yourPrice && marketAverage ? round2(yourPrice - marketAverage) : null;
      const gapPct =
        yourPrice && marketAverage
          ? round2(((yourPrice - marketAverage) / marketAverage) * 100)
          : null;
      const position =
        gapPct === null
          ? 'unknown'
          : Math.abs(gapPct) < 1
            ? 'aligned'
            : gapPct < 0
              ? 'below'
              : 'above';

      output.set(dateKey(rate.date), {
        yourPrice: yourPrice ? round2(yourPrice) : null,
        marketAverage: marketAverage ? round2(marketAverage) : null,
        gapAmount,
        gapPct,
        position,
        rank,
        rankTotal: rankingPrices.length,
        cheapestCompetitor,
        mostExpensiveCompetitor,
        aggressiveDrops
      });
    }

    return output;
  }

  private scoreOpportunity(input: {
    occupancy: number | null;
    pickup: PickupAggregate;
    market: MarketAggregate;
    daysToArrival: number;
    hotelRooms: number;
  }): number {
    const occupancyScore = clamp(((input.occupancy ?? 0) / 90) * 30, 0, 30);
    const pickupScore = clamp(
      (input.pickup.rooms7d / Math.max(1, input.hotelRooms * 0.08)) * 20,
      0,
      20
    );
    const underpricedScore =
      input.market.gapPct !== null && input.market.gapPct < 0
        ? clamp((Math.abs(input.market.gapPct) / 20) * 20, 0, 20)
        : 0;
    const leadScore = input.daysToArrival <= 30 ? 10 : input.daysToArrival <= 90 ? 6 : 3;
    const revenueScore = input.market.yourPrice
      ? clamp((input.pickup.rooms7d / 10) * 10, 0, 10)
      : 0;
    const trendScore = input.market.aggressiveDrops.length === 0 ? 10 : 4;

    return Math.round(
      occupancyScore + pickupScore + underpricedScore + leadScore + revenueScore + trendScore
    );
  }

  private scoreRisk(input: {
    occupancy: number | null;
    pickup: PickupAggregate;
    market: MarketAggregate;
    daysToArrival: number;
  }): number {
    const occupancy = input.occupancy ?? 0;
    const lowDemandScore = clamp(
      ((this.lowOccupancyThreshold - occupancy) / this.lowOccupancyThreshold) * 35,
      0,
      35
    );
    const noPickupScore =
      input.pickup.rooms7d === 0 ? 25 : clamp((3 - input.pickup.rooms7d) * 5, 0, 15);
    const overpricedScore =
      input.market.gapPct !== null && input.market.gapPct > 0
        ? clamp((input.market.gapPct / 20) * 20, 0, 20)
        : 0;
    const leadScore = input.daysToArrival <= 14 ? 20 : input.daysToArrival <= 30 ? 12 : 5;

    return Math.round(lowDemandScore + noPickupScore + overpricedScore + leadScore);
  }

  private buildSignals(input: {
    occupancy: number | null;
    pickup: PickupAggregate;
    market: MarketAggregate;
    daysToArrival: number;
  }): BiSignal[] {
    const signals: BiSignal[] = [];
    const occupancy = input.occupancy ?? 0;

    if (input.pickup.accelerated) {
      signals.push({
        type: 'accelerated-demand',
        title: 'Demanda acelerada',
        severity: 'high',
        message: `Pickup 7d de ${input.pickup.rooms7d} habitaciones supera el ritmo previo.`
      });
    }
    if (occupancy >= this.highOccupancyThreshold && input.pickup.rooms7d > 0) {
      signals.push({
        type: 'fast-filling-date',
        title: 'Fecha llenandose rapido',
        severity: occupancy >= 85 ? 'high' : 'medium',
        message: `Ocupacion ${round2(occupancy)}% con pickup reciente.`
      });
    }
    if (input.occupancy !== null && occupancy <= this.criticalOccupancyThreshold) {
      signals.push({
        type: 'extremely-low-demand',
        title: 'Fecha extremadamente baja',
        severity: 'high',
        message: `Ocupacion ${round2(occupancy)}% por debajo del umbral critico.`
      });
    }
    if (input.pickup.rooms7d === 0 && input.daysToArrival <= 30) {
      signals.push({
        type: 'no-recent-pickup',
        title: 'Sin pickup reciente',
        severity: input.daysToArrival <= 14 ? 'high' : 'medium',
        message: 'No hay reservas nuevas en los ultimos 7 dias para esta fecha.'
      });
    }
    if (input.market.gapPct !== null && input.market.gapPct <= -this.significantGapPct) {
      signals.push({
        type: 'price-below-comp-set',
        title: 'Precio debajo del comp set',
        severity: input.market.gapPct <= -15 ? 'high' : 'medium',
        message: `Tu tarifa esta ${Math.abs(input.market.gapPct).toFixed(1)}% debajo del promedio.`
      });
    }
    if (input.market.gapPct !== null && input.market.gapPct >= this.significantGapPct) {
      signals.push({
        type: 'price-above-comp-set',
        title: 'Precio encima del comp set',
        severity: input.market.gapPct >= 15 ? 'high' : 'medium',
        message: `Tu tarifa esta ${input.market.gapPct.toFixed(1)}% encima del promedio.`
      });
    }
    if (occupancy >= this.highOccupancyThreshold && (input.market.gapPct ?? 0) < 0) {
      signals.push({
        type: 'high-demand-low-price',
        title: 'Alta demanda con precio bajo',
        severity: 'high',
        message: 'La demanda sostiene una revision de tarifa al alza.'
      });
    }
    if (
      input.occupancy !== null &&
      occupancy <= this.lowOccupancyThreshold &&
      (input.market.gapPct ?? 0) > 0
    ) {
      signals.push({
        type: 'low-demand-high-price',
        title: 'Baja demanda con precio alto',
        severity: 'high',
        message: 'La baja ocupacion y sobreprecio elevan el riesgo de no conversion.'
      });
    }
    if (input.market.aggressiveDrops.length > 0) {
      signals.push({
        type: 'competitor-aggressive-drop',
        title: 'Competidor bajando agresivamente',
        severity: 'medium',
        message: `${input.market.aggressiveDrops.length} competidor(es) bajaron al menos 5%.`
      });
    }

    return signals;
  }

  private buildRecommendation(input: {
    occupancy: number | null;
    pickup: PickupAggregate;
    market: MarketAggregate;
    opportunityScore: number;
    riskScore: number;
    adr: number | null;
    hotelRooms: number;
  }): BiRecommendation {
    const occupancy = input.occupancy ?? 0;
    const evidence = this.buildEvidence(input);
    const estimatedImpact = this.estimateImpact(input);

    if (
      occupancy >= 85 &&
      input.pickup.rooms7d > 0 &&
      (input.market.gapPct ?? 0) < -this.significantGapPct
    ) {
      return {
        action: 'increase-aggressively',
        label: 'Subir tarifa agresivamente',
        severity: 'high',
        score: input.opportunityScore,
        reason: 'Alta demanda, pickup reciente y tarifa debajo del comp set.',
        evidence,
        estimatedImpact
      };
    }
    if (occupancy >= this.highOccupancyThreshold && (input.market.gapPct ?? 0) <= 0) {
      return {
        action: 'increase-slightly',
        label: 'Subir tarifa ligeramente',
        severity: 'medium',
        score: input.opportunityScore,
        reason: 'Demanda fuerte con precio alineado o debajo del mercado.',
        evidence,
        estimatedImpact
      };
    }
    if (
      occupancy <= this.lowOccupancyThreshold &&
      (input.market.gapPct ?? 0) >= this.significantGapPct
    ) {
      return {
        action: 'decrease-moderately',
        label: 'Bajar tarifa moderadamente',
        severity: 'high',
        score: input.riskScore,
        reason: 'Baja demanda y precio por encima del comp set.',
        evidence,
        estimatedImpact
      };
    }
    if (occupancy <= this.criticalOccupancyThreshold && input.pickup.rooms7d === 0) {
      return {
        action: 'review-promotion',
        label: 'Revisar promocion',
        severity: 'high',
        score: input.riskScore,
        reason: 'Ocupacion critica sin pickup reciente.',
        evidence,
        estimatedImpact
      };
    }
    if (occupancy <= this.lowOccupancyThreshold) {
      return {
        action: 'investigate-low-demand',
        label: 'Investigar baja demanda',
        severity: 'medium',
        score: input.riskScore,
        reason: 'La fecha esta por debajo del umbral de ocupacion.',
        evidence,
        estimatedImpact
      };
    }
    if (input.market.aggressiveDrops.length > 0) {
      return {
        action: 'monitor-competition',
        label: 'Monitorear competencia',
        severity: 'medium',
        score: Math.max(input.opportunityScore, input.riskScore),
        reason: 'Hay movimientos relevantes de competidores.',
        evidence,
        estimatedImpact
      };
    }

    return {
      action: 'hold',
      label: 'Mantener tarifa',
      severity: 'low',
      score: Math.max(input.opportunityScore, input.riskScore),
      reason: 'Demanda y posicion competitiva sin senales criticas.',
      evidence,
      estimatedImpact
    };
  }

  private buildEvidence(input: {
    occupancy: number | null;
    pickup: PickupAggregate;
    market: MarketAggregate;
    adr: number | null;
  }): string[] {
    const evidence: string[] = [];

    if (input.occupancy !== null) evidence.push(`Ocupacion ${round2(input.occupancy)}%`);
    evidence.push(`Pickup 7d: ${input.pickup.rooms7d} habitaciones`);
    if (input.adr !== null) evidence.push(`ADR ${round2(input.adr)}`);
    if (input.market.yourPrice !== null) evidence.push(`Tu tarifa ${input.market.yourPrice}`);
    if (input.market.marketAverage !== null)
      evidence.push(`Comp set promedio ${input.market.marketAverage}`);
    if (input.market.gapPct !== null) evidence.push(`Brecha comp set ${input.market.gapPct}%`);

    return evidence;
  }

  private estimateImpact(input: {
    occupancy: number | null;
    pickup: PickupAggregate;
    market: MarketAggregate;
    hotelRooms: number;
  }): number {
    if (!input.market.yourPrice || input.market.gapPct === null || input.market.gapPct >= 0) {
      return 0;
    }

    const occupancy = input.occupancy ?? 0;
    const remainingRooms = Math.max(
      0,
      input.hotelRooms - Math.round((occupancy / 100) * input.hotelRooms)
    );
    const conservativeRooms = Math.min(remainingRooms, Math.max(1, input.pickup.rooms7d));
    const suggestedLift = Math.min(Math.abs(input.market.gapPct), 10) / 100;

    return round2(input.market.yourPrice * suggestedLift * conservativeRooms);
  }

  private emptyPickup(): PickupAggregate {
    return {
      rooms1d: 0,
      rooms3d: 0,
      rooms7d: 0,
      rooms14d: 0,
      roomNights7d: 0,
      revenue7d: 0,
      adr7d: 0,
      accelerated: false
    };
  }

  private emptyMarket(): MarketAggregate {
    return {
      yourPrice: null,
      marketAverage: null,
      gapAmount: null,
      gapPct: null,
      position: 'unknown',
      rank: null,
      rankTotal: 0,
      cheapestCompetitor: null,
      mostExpensiveCompetitor: null,
      aggressiveDrops: []
    };
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private sortDesc<T>(rows: T[], getter: (row: T) => number): T[] {
    return [...rows].sort((a, b) => getter(b) - getter(a));
  }

  private hotelSummary(hotel: BiHotel) {
    return {
      id: hotel.id,
      name: hotel.name,
      totalRooms: hotel.totalRooms
    };
  }

  private exportRange(startDate: Date, endDate: Date): { start: string; end: string } {
    return {
      start: toUtcDateOnly(startDate).toISOString().slice(0, 10),
      end: toUtcDateOnly(endDate).toISOString().slice(0, 10)
    };
  }

  private csvCell(value: unknown): string {
    const text = value === null || value === undefined ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  private csvNumber(value: number | null): string {
    return value === null ? '' : String(value);
  }

  private dayOfWeek(date: string): string {
    return new Date(`${date}T00:00:00.000Z`)
      .toLocaleDateString('es-MX', { weekday: 'short', timeZone: 'UTC' })
      .replace('.', '')
      .toUpperCase();
  }

  private buildRevenueReportPdf(input: {
    hotel: BiExportHotel;
    range: { start: string; end: string };
    generatedAt: string;
    summary: Awaited<ReturnType<BiService['getExecutiveSummary']>>;
    rows: RevenueCalendarItem[];
  }): Buffer {
    const pages: string[] = [];
    const width = 842;
    const height = 595;
    const margin = 32;
    const lineHeight = 13;
    let lines: Array<{ text: string; x: number; y: number; size: number; bold?: boolean }> = [];
    let y = height - margin;

    const addPage = () => {
      pages.push(this.pdfPageContent(lines));
      lines = [];
      y = height - margin;
    };
    const addLine = (text: string, options?: { x?: number; size?: number; bold?: boolean }) => {
      if (y < margin + 18) {
        addPage();
      }
      lines.push({
        text,
        x: options?.x ?? margin,
        y,
        size: options?.size ?? 9,
        bold: options?.bold
      });
      y -= lineHeight;
    };
    const addSpacer = (points = 8) => {
      y -= points;
    };

    addLine('Revenue Intelligence Report', { size: 18, bold: true });
    addLine(input.hotel.name, { size: 10 });
    addLine(`Rango: ${input.range.start} a ${input.range.end}  |  Generado: ${input.generatedAt}`);
    addSpacer();
    addLine('KPIs ejecutivos', { size: 12, bold: true });
    addLine(
      `Ocupacion prom.: ${input.summary.kpis.avg_occupancy}%   ADR prom.: ${input.hotel.currency ?? 'MXN'} ${input.summary.kpis.avg_adr}   Revenue: ${input.hotel.currency ?? 'MXN'} ${input.summary.kpis.total_revenue}   Alertas activas: ${input.summary.kpis.active_alerts}`
    );
    addLine(
      `Debajo comp set: ${input.summary.kpis.below_comp_set_dates}   Encima comp set: ${input.summary.kpis.above_comp_set_dates}   Baja demanda: ${input.summary.kpis.extremely_low_dates}`
    );
    addSpacer();
    addLine('Top oportunidades', { size: 12, bold: true });
    for (const row of input.summary.top_opportunities.slice(0, 5)) {
      addLine(
        `${row.date} | Opp ${row.opportunityScore} | Occ ${this.pdfValue(row.occupancy, '%')} | Gap ${this.pdfValue(row.market.gapPct, '%')} | ${row.recommendation.label}`
      );
    }
    if (input.summary.top_opportunities.length === 0) addLine('Sin oportunidades para el rango.');
    addSpacer();
    addLine('Top riesgos', { size: 12, bold: true });
    for (const row of input.summary.top_risks.slice(0, 5)) {
      addLine(
        `${row.date} | Risk ${row.riskScore} | Occ ${this.pdfValue(row.occupancy, '%')} | PU7D ${row.pickup.rooms7d} | ${row.recommendation.label}`
      );
    }
    if (input.summary.top_risks.length === 0) addLine('Sin riesgos para el rango.');
    addSpacer();
    addLine('Revenue Calendar resumido', { size: 12, bold: true });
    addLine(
      'Fecha       DOW  DTA  Occ    PU  ADR      Revenue    Tarifa   Gap    Opp Risk Accion',
      {
        bold: true
      }
    );

    for (const row of input.rows) {
      addLine(
        [
          row.date.padEnd(10),
          this.dayOfWeek(row.date).padEnd(4),
          String(row.daysToArrival).padStart(3),
          this.pdfValue(row.occupancy, '%').padStart(6),
          String(row.pickup.rooms7d).padStart(3),
          this.pdfValue(row.adr).padStart(8),
          this.pdfValue(row.revenue).padStart(10),
          this.pdfValue(row.market.yourPrice).padStart(8),
          this.pdfValue(row.market.gapPct, '%').padStart(6),
          String(row.opportunityScore).padStart(3),
          String(row.riskScore).padStart(4),
          row.recommendation.label
        ].join(' ')
      );
    }
    if (input.rows.length === 0) addLine('Sin datos para el rango seleccionado.');
    pages.push(this.pdfPageContent(lines));

    return this.assemblePdf(pages, width, height);
  }

  private pdfValue(value: number | null, suffix = ''): string {
    return value === null ? '-' : `${value}${suffix}`;
  }

  private pdfPageContent(
    lines: Array<{ text: string; x: number; y: number; size: number; bold?: boolean }>
  ): string {
    return lines
      .map((line) => {
        const font = line.bold ? 'F2' : 'F1';
        return `BT /${font} ${line.size} Tf ${line.x} ${line.y} Td (${this.escapePdfText(
          line.text
        )}) Tj ET`;
      })
      .join('\n');
  }

  private escapePdfText(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  private assemblePdf(pageContents: string[], width: number, height: number): Buffer {
    const objects: string[] = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      `<< /Type /Pages /Kids [${pageContents
        .map((_, index) => `${3 + index * 2} 0 R`)
        .join(' ')}] /Count ${pageContents.length} >>`
    ];

    pageContents.forEach((content, index) => {
      const pageObjectId = 3 + index * 2;
      const contentObjectId = pageObjectId + 1;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >> /Contents ${contentObjectId} 0 R >>`
      );
      objects.push(
        `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`
      );
    });

    let body = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(body, 'ascii'));
      body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(body, 'ascii');
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    body += offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join('');
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(body, 'ascii');
  }
}
