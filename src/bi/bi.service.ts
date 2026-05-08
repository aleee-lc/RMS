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
}
