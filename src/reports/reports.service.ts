import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RecommendationAction } from '@prisma/client';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Handlebars from 'handlebars';
import puppeteer from 'puppeteer';
import { dateKey, enumerateDateRange, toUtcDateOnly } from '../common/utils/date.util';
import { round2 } from '../common/utils/number.util';
import { PrismaService } from '../prisma/prisma.service';

interface DateRangeInput {
  startDate: Date;
  endDate: Date;
}

interface CrsReconciliationInput {
  startDate?: Date;
  endDate?: Date;
  whichDate?: string;
}

interface RevenueCalendarPdfInput {
  hotelName: string;
  printedBy: string;
}

interface RevenueCalendarRow {
  date: string;
  dow: string;
  dta: number;
  occ: number;
  pu7d: number;
  adr: number;
  revenue: number;
  tarifa: number;
  compSet: number;
  gap: number;
  gapRank: string;
  rank: string;
}

interface RevenueCalendarTemplateContext {
  title: string;
  hotelName: string;
  dateRange: string;
  printedAt: string;
  printedBy: string;
  rows: RevenueCalendarRow[];
}

@Injectable()
export class ReportsService {
  private readonly significantPriceDiffPct = 10;
  private readonly logger = new Logger(ReportsService.name);
  private static helpersRegistered = false;

  constructor(private readonly prisma: PrismaService) {}

  async generateRevenueCalendarPdf(id: string, input: RevenueCalendarPdfInput): Promise<Buffer> {
    this.registerRevenueCalendarHelpers();

    const context = this.buildMockRevenueCalendarReport(id, input);
    try {
      const html = await this.renderRevenueCalendarTemplate(context);
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
      });

      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load' });

        const pdf = await page.pdf({
          displayHeaderFooter: true,
          footerTemplate: this.buildRevenueCalendarFooterTemplate(context),
          format: 'Letter',
          headerTemplate: '<div></div>',
          landscape: true,
          margin: {
            top: '26px',
            right: '26px',
            bottom: '68px',
            left: '26px'
          },
          printBackground: true
        });

        return Buffer.from(pdf);
      } finally {
        await browser.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Revenue calendar PDF generation failed: ${message}`);
      return this.buildFallbackRevenueCalendarPdf(context);
    }
  }

  async getPickupReport(hotelId: number, bookingRange: DateRangeInput, stayRange: DateRangeInput) {
    const reservations = await this.prisma.reservationRaw.findMany({
      where: {
        hotelId,
        bookingDate: {
          gte: toUtcDateOnly(bookingRange.startDate),
          lte: toUtcDateOnly(bookingRange.endDate)
        },
        arrivalDate: {
          gte: toUtcDateOnly(stayRange.startDate),
          lte: toUtcDateOnly(stayRange.endDate)
        }
      },
      orderBy: [{ bookingDate: 'asc' }, { arrivalDate: 'asc' }]
    });

    const activeReservations = reservations.filter(
      (reservation) => !this.isExcludedReservationStatus(reservation.sourceStatus)
    );

    const bookingMap = new Map<
      string,
      {
        reservationsCount: number;
        roomsBooked: number;
        revenueBooked: number;
        futureRoomsBooked: number;
        futureRevenueBooked: number;
      }
    >();

    const stayMap = new Map<
      string,
      {
        reservationsCount: number;
        roomsBooked: number;
        revenueBooked: number;
        firstBookingDate: Date;
        lastBookingDate: Date;
      }
    >();

    for (const reservation of activeReservations) {
      const bookingKey = dateKey(reservation.bookingDate);
      const stayKey = dateKey(reservation.arrivalDate);
      const rooms = reservation.noOfRooms || 1;
      const roomRate = Number(reservation.roomRate ?? 0);
      const revenue = round2(rooms * roomRate);

      const bookingEntry =
        bookingMap.get(bookingKey) ??
        ({
          reservationsCount: 0,
          roomsBooked: 0,
          revenueBooked: 0,
          futureRoomsBooked: 0,
          futureRevenueBooked: 0
        } as const);

      bookingMap.set(bookingKey, {
        reservationsCount: bookingEntry.reservationsCount + 1,
        roomsBooked: bookingEntry.roomsBooked + rooms,
        revenueBooked: round2(bookingEntry.revenueBooked + revenue),
        futureRoomsBooked:
          bookingEntry.futureRoomsBooked +
          (reservation.arrivalDate >= reservation.bookingDate ? rooms : 0),
        futureRevenueBooked: round2(
          bookingEntry.futureRevenueBooked +
            (reservation.arrivalDate >= reservation.bookingDate ? revenue : 0)
        )
      });

      const stayEntry =
        stayMap.get(stayKey) ??
        ({
          reservationsCount: 0,
          roomsBooked: 0,
          revenueBooked: 0,
          firstBookingDate: reservation.bookingDate,
          lastBookingDate: reservation.bookingDate
        } as const);

      stayMap.set(stayKey, {
        reservationsCount: stayEntry.reservationsCount + 1,
        roomsBooked: stayEntry.roomsBooked + rooms,
        revenueBooked: round2(stayEntry.revenueBooked + revenue),
        firstBookingDate:
          reservation.bookingDate < stayEntry.firstBookingDate
            ? reservation.bookingDate
            : stayEntry.firstBookingDate,
        lastBookingDate:
          reservation.bookingDate > stayEntry.lastBookingDate
            ? reservation.bookingDate
            : stayEntry.lastBookingDate
      });
    }

    const dailyBookingPickup = [...bookingMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([bookingDate, value]) => ({
        booking_date: bookingDate,
        reservations_count: value.reservationsCount,
        rooms_booked: value.roomsBooked,
        revenue_booked: round2(value.revenueBooked),
        future_rooms_booked: value.futureRoomsBooked,
        future_revenue_booked: round2(value.futureRevenueBooked)
      }));

    const stayDatePickup = [...stayMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([stayDate, value]) => ({
        stay_date: stayDate,
        reservations_count: value.reservationsCount,
        rooms_booked: value.roomsBooked,
        revenue_booked: round2(value.revenueBooked),
        avg_room_rate: value.roomsBooked > 0 ? round2(value.revenueBooked / value.roomsBooked) : 0,
        first_booking_date: dateKey(value.firstBookingDate),
        last_booking_date: dateKey(value.lastBookingDate)
      }));

    const totals = dailyBookingPickup.reduce(
      (acc, day) => {
        acc.reservations_count += day.reservations_count;
        acc.rooms_booked += day.rooms_booked;
        acc.revenue_booked = round2(acc.revenue_booked + day.revenue_booked);
        return acc;
      },
      { reservations_count: 0, rooms_booked: 0, revenue_booked: 0 }
    );

    return {
      report: 'pickup',
      booking_window: {
        start: dateKey(bookingRange.startDate),
        end: dateKey(bookingRange.endDate)
      },
      stay_window: {
        start: dateKey(stayRange.startDate),
        end: dateKey(stayRange.endDate)
      },
      summary: {
        active_reservations_considered: activeReservations.length,
        ...totals
      },
      daily_booking_pickup: dailyBookingPickup,
      stay_date_pickup: stayDatePickup
    };
  }

  async getForecastVarianceReport(hotelId: number, range: DateRangeInput) {
    const today = toUtcDateOnly(new Date());

    const [baselineMetrics, reservations, hotel] = await Promise.all([
      this.prisma.dailyMetrics.findMany({
        where: {
          hotelId,
          date: {
            gte: toUtcDateOnly(range.startDate),
            lte: toUtcDateOnly(range.endDate)
          }
        },
        orderBy: { date: 'asc' }
      }),
      this.prisma.reservationRaw.findMany({
        where: {
          hotelId,
          arrivalDate: {
            gte: toUtcDateOnly(range.startDate),
            lte: toUtcDateOnly(range.endDate)
          },
          bookingDate: {
            lte: today
          }
        }
      }),
      this.prisma.hotel.findUniqueOrThrow({ where: { id: hotelId } })
    ]);

    const baselineMap = new Map(baselineMetrics.map((metric) => [dateKey(metric.date), metric]));

    const otbMap = new Map<string, { rooms: number; revenue: number }>();
    for (const reservation of reservations) {
      if (this.isExcludedReservationStatus(reservation.sourceStatus)) {
        continue;
      }

      const key = dateKey(reservation.arrivalDate);
      const rooms = reservation.noOfRooms || 1;
      const revenue = Number(reservation.roomRate ?? 0) * rooms;
      const current = otbMap.get(key) ?? { rooms: 0, revenue: 0 };

      current.rooms += rooms;
      current.revenue += revenue;
      otbMap.set(key, current);
    }

    const rows = enumerateDateRange(range.startDate, range.endDate).map((date) => {
      const key = dateKey(date);
      const baseline = baselineMap.get(key);
      const otb = otbMap.get(key) ?? { rooms: 0, revenue: 0 };

      const forecastRooms = baseline?.bookedRooms ?? 0;
      const forecastRevenue = Number(baseline?.revenue ?? 0);
      const forecastOccupancy = Number(baseline?.occupancy ?? 0);

      const otbRooms = otb.rooms;
      const otbRevenue = round2(otb.revenue);
      const otbOccupancy = hotel.totalRooms > 0 ? round2((otbRooms / hotel.totalRooms) * 100) : 0;

      const varianceRooms = otbRooms - forecastRooms;
      const varianceRevenue = round2(otbRevenue - forecastRevenue);
      const varianceOccupancy = round2(otbOccupancy - forecastOccupancy);

      return {
        date: key,
        forecast_rooms: forecastRooms,
        otb_rooms: otbRooms,
        variance_rooms: varianceRooms,
        variance_rooms_pct:
          forecastRooms > 0 ? round2((varianceRooms / forecastRooms) * 100) : null,
        forecast_revenue: round2(forecastRevenue),
        otb_revenue: otbRevenue,
        variance_revenue: varianceRevenue,
        variance_revenue_pct:
          forecastRevenue > 0 ? round2((varianceRevenue / forecastRevenue) * 100) : null,
        forecast_occupancy: round2(forecastOccupancy),
        otb_occupancy: otbOccupancy,
        variance_occupancy: varianceOccupancy,
        status:
          varianceRooms > 0
            ? 'above_forecast'
            : varianceRooms < 0
              ? 'below_forecast'
              : 'on_forecast'
      };
    });

    const summary = {
      above_forecast_days: rows.filter((row) => row.variance_rooms > 0).length,
      below_forecast_days: rows.filter((row) => row.variance_rooms < 0).length,
      on_forecast_days: rows.filter((row) => row.variance_rooms === 0).length,
      total_rooms_variance: rows.reduce((sum, row) => sum + row.variance_rooms, 0),
      total_revenue_variance: round2(rows.reduce((sum, row) => sum + row.variance_revenue, 0))
    };

    return {
      report: 'forecast-variance',
      assumptions: {
        baseline_source: 'DailyMetrics',
        otb_source: 'ReservationRaw (bookingDate <= today)',
        excluded_statuses: ['NO SHOW', 'CANCEL*']
      },
      date_range: {
        start: dateKey(range.startDate),
        end: dateKey(range.endDate)
      },
      summary,
      items: rows
    };
  }

  async getMarketPositionReport(hotelId: number, range: DateRangeInput) {
    const rates = await this.prisma.marketRates.findMany({
      where: {
        hotelId,
        date: {
          gte: toUtcDateOnly(range.startDate),
          lte: toUtcDateOnly(range.endDate)
        }
      },
      orderBy: { date: 'asc' },
      include: {
        competitorRates: {
          include: {
            competitor: true
          }
        }
      }
    });

    const items = rates.map((rate) => {
      const yourPrice = Number(rate.yourPrice ?? 0);
      const marketAverage = Number(rate.marketAverage ?? 0);
      const competitorPrices = rate.competitorRates.map((entry) => Number(entry.price ?? 0));

      const cheaperCompetitors = competitorPrices.filter(
        (price) => price > 0 && price < yourPrice
      ).length;
      const expensiveCompetitors = competitorPrices.filter(
        (price) => price > 0 && price > yourPrice
      ).length;

      const priceGap = round2(yourPrice - marketAverage);
      const priceGapPct = marketAverage > 0 ? round2((priceGap / marketAverage) * 100) : null;

      let position: 'underpriced' | 'aligned' | 'overpriced' = 'aligned';
      if (priceGapPct !== null && priceGapPct <= -this.significantPriceDiffPct) {
        position = 'underpriced';
      }
      if (priceGapPct !== null && priceGapPct >= this.significantPriceDiffPct) {
        position = 'overpriced';
      }

      return {
        date: dateKey(rate.date),
        your_price: yourPrice,
        market_average: round2(marketAverage),
        price_gap: priceGap,
        price_gap_pct: priceGapPct,
        competitor_count: competitorPrices.length,
        cheaper_competitors: cheaperCompetitors,
        more_expensive_competitors: expensiveCompetitors,
        position_rank: yourPrice > 0 ? cheaperCompetitors + 1 : null,
        position,
        competitors: rate.competitorRates.map((entry) => ({
          name: entry.competitor.name,
          price: Number(entry.price)
        }))
      };
    });

    const summary = {
      days: items.length,
      underpriced_days: items.filter((item) => item.position === 'underpriced').length,
      aligned_days: items.filter((item) => item.position === 'aligned').length,
      overpriced_days: items.filter((item) => item.position === 'overpriced').length,
      avg_price_gap_pct:
        items.filter((item) => item.price_gap_pct !== null).length > 0
          ? round2(
              items
                .filter((item) => item.price_gap_pct !== null)
                .reduce((sum, item) => sum + Number(item.price_gap_pct), 0) /
                items.filter((item) => item.price_gap_pct !== null).length
            )
          : null
    };

    return {
      report: 'market-position',
      date_range: {
        start: dateKey(range.startDate),
        end: dateKey(range.endDate)
      },
      summary,
      items
    };
  }

  async getRecommendationComplianceReport(
    hotelId: number,
    range: DateRangeInput,
    tolerancePct: number
  ) {
    const [recommendations, metrics] = await Promise.all([
      this.prisma.recommendations.findMany({
        where: {
          hotelId,
          date: {
            gte: toUtcDateOnly(range.startDate),
            lte: toUtcDateOnly(range.endDate)
          }
        },
        orderBy: { date: 'asc' },
        include: {
          marketRate: true
        }
      }),
      this.prisma.dailyMetrics.findMany({
        where: {
          hotelId,
          date: {
            gte: toUtcDateOnly(range.startDate),
            lte: toUtcDateOnly(range.endDate)
          }
        }
      })
    ]);

    const metricsByDate = new Map(metrics.map((metric) => [dateKey(metric.date), metric]));

    const toleranceFactor = tolerancePct / 100;

    const items = recommendations.map((recommendation) => {
      const key = dateKey(recommendation.date);
      const currentPrice = Number(
        recommendation.marketRate?.yourPrice ?? recommendation.yourPrice ?? 0
      );
      const suggestedPrice = Number(recommendation.suggestedPrice ?? 0);
      const bookedRooms = metricsByDate.get(key)?.bookedRooms ?? 0;

      let compliance: 'compliant' | 'non_compliant' | 'unknown' = 'unknown';

      if (suggestedPrice > 0 && currentPrice > 0) {
        switch (recommendation.action) {
          case RecommendationAction.HOLD: {
            const diffPct = Math.abs(currentPrice - suggestedPrice) / suggestedPrice;
            compliance = diffPct <= toleranceFactor ? 'compliant' : 'non_compliant';
            break;
          }
          case RecommendationAction.INCREASE:
            compliance =
              currentPrice >= suggestedPrice * (1 - toleranceFactor)
                ? 'compliant'
                : 'non_compliant';
            break;
          case RecommendationAction.DECREASE:
            compliance =
              currentPrice <= suggestedPrice * (1 + toleranceFactor)
                ? 'compliant'
                : 'non_compliant';
            break;
          default:
            compliance = 'unknown';
        }
      }

      const gap = round2(currentPrice - suggestedPrice);
      const gapPct = suggestedPrice > 0 ? round2((gap / suggestedPrice) * 100) : null;
      const estimatedRevenueImpact = round2((suggestedPrice - currentPrice) * bookedRooms);

      return {
        date: key,
        action: recommendation.action.toLowerCase(),
        current_price: currentPrice,
        suggested_price: suggestedPrice,
        price_gap: gap,
        price_gap_pct: gapPct,
        booked_rooms: bookedRooms,
        compliance,
        estimated_revenue_impact_if_adjusted: estimatedRevenueImpact,
        explanation: recommendation.explanation
      };
    });

    const summary = {
      tolerance_pct: tolerancePct,
      total: items.length,
      compliant: items.filter((item) => item.compliance === 'compliant').length,
      non_compliant: items.filter((item) => item.compliance === 'non_compliant').length,
      unknown: items.filter((item) => item.compliance === 'unknown').length,
      increase_actions: items.filter((item) => item.action === 'increase').length,
      decrease_actions: items.filter((item) => item.action === 'decrease').length,
      hold_actions: items.filter((item) => item.action === 'hold').length
    };

    return {
      report: 'recommendation-compliance',
      date_range: {
        start: dateKey(range.startDate),
        end: dateKey(range.endDate)
      },
      summary,
      items
    };
  }

  async getRevenueOpportunityReport(hotelId: number, range: DateRangeInput) {
    const [recommendations, metrics] = await Promise.all([
      this.prisma.recommendations.findMany({
        where: {
          hotelId,
          date: {
            gte: toUtcDateOnly(range.startDate),
            lte: toUtcDateOnly(range.endDate)
          }
        },
        include: {
          marketRate: true
        },
        orderBy: { date: 'asc' }
      }),
      this.prisma.dailyMetrics.findMany({
        where: {
          hotelId,
          date: {
            gte: toUtcDateOnly(range.startDate),
            lte: toUtcDateOnly(range.endDate)
          }
        }
      })
    ]);

    const metricsByDate = new Map(metrics.map((metric) => [dateKey(metric.date), metric]));

    const items = recommendations.map((recommendation) => {
      const key = dateKey(recommendation.date);
      const currentPrice = Number(
        recommendation.marketRate?.yourPrice ?? recommendation.yourPrice ?? 0
      );
      const suggestedPrice = Number(recommendation.suggestedPrice ?? 0);
      const rooms = metricsByDate.get(key)?.bookedRooms ?? 0;

      const delta = round2(suggestedPrice - currentPrice);

      const upsidePotential =
        recommendation.action === RecommendationAction.INCREASE && delta > 0
          ? round2(delta * rooms)
          : 0;

      const overpricingRisk =
        recommendation.action === RecommendationAction.DECREASE && delta < 0
          ? round2(Math.abs(delta) * rooms)
          : 0;

      return {
        date: key,
        action: recommendation.action.toLowerCase(),
        current_price: currentPrice,
        suggested_price: suggestedPrice,
        booked_rooms: rooms,
        price_delta: delta,
        upside_potential: upsidePotential,
        overpricing_risk: overpricingRisk,
        explanation: recommendation.explanation
      };
    });

    const summary = {
      total_days: items.length,
      upside_days: items.filter((item) => item.upside_potential > 0).length,
      risk_days: items.filter((item) => item.overpricing_risk > 0).length,
      total_upside_potential: round2(items.reduce((sum, item) => sum + item.upside_potential, 0)),
      total_overpricing_risk: round2(items.reduce((sum, item) => sum + item.overpricing_risk, 0))
    };

    const topUpside = [...items]
      .filter((item) => item.upside_potential > 0)
      .sort((a, b) => b.upside_potential - a.upside_potential)
      .slice(0, 10);

    const topRisk = [...items]
      .filter((item) => item.overpricing_risk > 0)
      .sort((a, b) => b.overpricing_risk - a.overpricing_risk)
      .slice(0, 10);

    return {
      report: 'revenue-opportunity',
      date_range: {
        start: dateKey(range.startDate),
        end: dateKey(range.endDate)
      },
      summary,
      top_upside_days: topUpside,
      top_overpricing_risk_days: topRisk,
      items
    };
  }

  async getExecutiveSummaryReport(hotelId: number, range: DateRangeInput) {
    const [metrics, alerts, recommendations, marketPosition, revenueOpportunity] =
      await Promise.all([
        this.prisma.dailyMetrics.findMany({
          where: {
            hotelId,
            date: {
              gte: toUtcDateOnly(range.startDate),
              lte: toUtcDateOnly(range.endDate)
            }
          }
        }),
        this.prisma.alerts.findMany({
          where: {
            hotelId,
            date: {
              gte: toUtcDateOnly(range.startDate),
              lte: toUtcDateOnly(range.endDate)
            },
            resolved: false
          }
        }),
        this.prisma.recommendations.findMany({
          where: {
            hotelId,
            date: {
              gte: toUtcDateOnly(range.startDate),
              lte: toUtcDateOnly(range.endDate)
            }
          }
        }),
        this.getMarketPositionReport(hotelId, range),
        this.getRevenueOpportunityReport(hotelId, range)
      ]);

    const avgOccupancy =
      metrics.length > 0
        ? round2(
            metrics.reduce((sum, metric) => sum + Number(metric.occupancy), 0) / metrics.length
          )
        : 0;

    const avgAdr =
      metrics.length > 0
        ? round2(metrics.reduce((sum, metric) => sum + Number(metric.adr), 0) / metrics.length)
        : 0;

    const totalRevenue = round2(metrics.reduce((sum, metric) => sum + Number(metric.revenue), 0));

    return {
      report: 'executive-summary',
      date_range: {
        start: dateKey(range.startDate),
        end: dateKey(range.endDate)
      },
      kpis: {
        avg_occupancy: avgOccupancy,
        avg_adr: avgAdr,
        total_revenue: totalRevenue,
        active_alerts: alerts.length,
        recommendations: {
          total: recommendations.length,
          increase: recommendations.filter((item) => item.action === RecommendationAction.INCREASE)
            .length,
          decrease: recommendations.filter((item) => item.action === RecommendationAction.DECREASE)
            .length,
          hold: recommendations.filter((item) => item.action === RecommendationAction.HOLD).length
        },
        market_position: marketPosition.summary,
        revenue_opportunity: revenueOpportunity.summary
      },
      highlights: {
        top_upside_days: revenueOpportunity.top_upside_days,
        top_overpricing_risk_days: revenueOpportunity.top_overpricing_risk_days,
        open_alerts: alerts
          .sort((a, b) => b.date.getTime() - a.date.getTime())
          .slice(0, 10)
          .map((alert) => ({
            date: dateKey(alert.date),
            severity: alert.severity.toLowerCase(),
            title: alert.title,
            message: alert.message
          }))
      }
    };
  }

  async getCrsReconciliationReport(hotelId: number, query: CrsReconciliationInput) {
    const snapshotWhere: {
      hotelId: number;
      criteriaStartDate?: Date;
      criteriaEndDate?: Date;
      criteriaWhichDate?: { contains: string; mode: 'insensitive' };
    } = {
      hotelId
    };

    if (query.startDate) {
      snapshotWhere.criteriaStartDate = toUtcDateOnly(query.startDate);
    }
    if (query.endDate) {
      snapshotWhere.criteriaEndDate = toUtcDateOnly(query.endDate);
    }
    if (query.whichDate) {
      snapshotWhere.criteriaWhichDate = {
        contains: query.whichDate.trim(),
        mode: 'insensitive'
      };
    }

    const snapshot = await this.prisma.crsRoomRateDistributionSnapshot.findFirst({
      where: snapshotWhere,
      orderBy: [{ reportExecutionTime: 'desc' }, { createdAt: 'desc' }]
    });

    if (!snapshot) {
      throw new NotFoundException(
        'No CRS RoomRateDistribution snapshot found for this hotel and filter.'
      );
    }

    const range = {
      startDate: snapshot.criteriaStartDate,
      endDate: snapshot.criteriaEndDate
    };

    const basis = this.resolveCrsDateBasis(snapshot.criteriaWhichDate);

    const rmsTotals =
      basis === 'confirmation'
        ? await this.calculateConfirmationWindowTotals(hotelId, range)
        : await this.calculateStayWindowTotals(hotelId, range);

    const crsTotals = {
      reservations: snapshot.totalReservationCount,
      room_nights: snapshot.totalRoomNights,
      revenue: Number(snapshot.totalRevenue),
      adr: Number(snapshot.totalAdr)
    };

    const reservationsVariance = this.computeVariance(
      rmsTotals.reservations,
      crsTotals.reservations
    );
    const roomNightsVariance = this.computeVariance(rmsTotals.room_nights, crsTotals.room_nights);
    const revenueVariance = this.computeVariance(rmsTotals.revenue, crsTotals.revenue);
    const adrVariance = this.computeVariance(rmsTotals.adr, crsTotals.adr);

    const mismatchFlags = {
      reservations: this.isSignificantMismatch(reservationsVariance.deltaPct, 5),
      room_nights: this.isSignificantMismatch(roomNightsVariance.deltaPct, 5),
      revenue: this.isSignificantMismatch(revenueVariance.deltaPct, 5),
      adr: this.isSignificantMismatch(adrVariance.deltaPct, 3)
    };

    return {
      report: 'crs-reconciliation',
      date_range: {
        start: dateKey(range.startDate),
        end: dateKey(range.endDate)
      },
      comparison_basis: basis,
      assumptions: {
        crs_which_date: snapshot.criteriaWhichDate,
        rms_basis:
          basis === 'confirmation'
            ? 'ReservationRaw by bookingDate, excluding NO SHOW/CANCEL'
            : 'DailyMetrics by stay date + ReservationRaw arrival count'
      },
      crs_snapshot: {
        id: snapshot.id,
        source_file: snapshot.sourceFile,
        execution_time: snapshot.reportExecutionTime?.toISOString() ?? null,
        show_groups: snapshot.criteriaShowGroups,
        currency: snapshot.criteriaCurrency,
        total_label: snapshot.sourceTotalLabel
      },
      totals: {
        crs: crsTotals,
        rms: rmsTotals
      },
      variance: {
        reservations: reservationsVariance,
        room_nights: roomNightsVariance,
        revenue: revenueVariance,
        adr: adrVariance
      },
      summary: {
        significant_mismatch: Object.values(mismatchFlags).some(Boolean),
        mismatch_flags: mismatchFlags
      }
    };
  }

  defaultPastRange(daysBack: number): DateRangeInput {
    const endDate = toUtcDateOnly(new Date());
    const startDate = new Date(endDate);
    startDate.setUTCDate(endDate.getUTCDate() - daysBack);

    return {
      startDate,
      endDate
    };
  }

  defaultFutureRange(daysForward: number): DateRangeInput {
    const startDate = toUtcDateOnly(new Date());
    const endDate = new Date(startDate);
    endDate.setUTCDate(startDate.getUTCDate() + daysForward);

    return {
      startDate,
      endDate
    };
  }

  private async calculateConfirmationWindowTotals(hotelId: number, range: DateRangeInput) {
    const reservations = await this.prisma.reservationRaw.findMany({
      where: {
        hotelId,
        bookingDate: {
          gte: toUtcDateOnly(range.startDate),
          lte: toUtcDateOnly(range.endDate)
        }
      },
      select: {
        noOfRooms: true,
        nights: true,
        roomRate: true,
        sourceStatus: true
      }
    });

    const active = reservations.filter(
      (reservation) => !this.isExcludedReservationStatus(reservation.sourceStatus)
    );

    let roomNights = 0;
    let revenue = 0;

    for (const reservation of active) {
      const rooms = Math.max(1, reservation.noOfRooms || 1);
      const nights = Math.max(1, reservation.nights || 1);
      const rate = Number(reservation.roomRate ?? 0);

      roomNights += rooms * nights;
      revenue += rooms * nights * rate;
    }

    const adr = roomNights > 0 ? round2(revenue / roomNights) : 0;

    return {
      reservations: active.length,
      room_nights: roomNights,
      revenue: round2(revenue),
      adr,
      source_rows: active.length
    };
  }

  private async calculateStayWindowTotals(hotelId: number, range: DateRangeInput) {
    const [metrics, reservations] = await Promise.all([
      this.prisma.dailyMetrics.findMany({
        where: {
          hotelId,
          date: {
            gte: toUtcDateOnly(range.startDate),
            lte: toUtcDateOnly(range.endDate)
          }
        }
      }),
      this.prisma.reservationRaw.findMany({
        where: {
          hotelId,
          arrivalDate: {
            gte: toUtcDateOnly(range.startDate),
            lte: toUtcDateOnly(range.endDate)
          }
        },
        select: {
          sourceStatus: true
        }
      })
    ]);

    const activeReservations = reservations.filter(
      (reservation) => !this.isExcludedReservationStatus(reservation.sourceStatus)
    ).length;

    const roomNights = metrics.reduce((sum, metric) => sum + metric.bookedRooms, 0);
    const revenue = round2(metrics.reduce((sum, metric) => sum + Number(metric.revenue), 0));
    const adr = roomNights > 0 ? round2(revenue / roomNights) : 0;

    return {
      reservations: activeReservations,
      room_nights: roomNights,
      revenue,
      adr,
      source_rows: metrics.length
    };
  }

  private resolveCrsDateBasis(whichDate: string): 'confirmation' | 'stay' {
    const normalized = (whichDate ?? '').toUpperCase();
    if (normalized.includes('CONFIRM') || normalized.includes('BOOK')) {
      return 'confirmation';
    }

    return 'stay';
  }

  private computeVariance(actual: number, baseline: number) {
    const delta = round2(actual - baseline);
    const deltaPct = baseline !== 0 ? round2((delta / baseline) * 100) : null;
    return {
      actual: round2(actual),
      baseline: round2(baseline),
      delta,
      deltaPct
    };
  }

  private isSignificantMismatch(deltaPct: number | null, tolerancePct: number): boolean {
    if (deltaPct === null) {
      return false;
    }
    return Math.abs(deltaPct) > tolerancePct;
  }

  private isExcludedReservationStatus(status: string | null | undefined): boolean {
    const normalized = (status ?? '').toUpperCase();
    return normalized.includes('NO SHOW') || normalized.includes('CANCEL');
  }

  private registerRevenueCalendarHelpers() {
    if (ReportsService.helpersRegistered) {
      return;
    }

    Handlebars.registerHelper('money', (value: unknown) =>
      new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        maximumFractionDigits: 0
      }).format(Number(value ?? 0))
    );

    Handlebars.registerHelper('percent', (value: unknown) =>
      `${new Intl.NumberFormat('es-MX', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }).format(Number(value ?? 0))}%`
    );

    Handlebars.registerHelper('gapClass', (gap: unknown) =>
      Number(gap ?? 0) > 0 ? 'gap-positive' : 'gap-negative'
    );

    Handlebars.registerHelper('isFirstRow', (index: unknown) => Number(index ?? -1) === 0);

    ReportsService.helpersRegistered = true;
  }

  private buildMockRevenueCalendarReport(
    id: string,
    input: RevenueCalendarPdfInput
  ): RevenueCalendarTemplateContext {
    const printedAt = this.formatPrintedAt(new Date());

    return {
      title: 'Revenue calendar',
      hotelName: input.hotelName || 'Hotel Name',
      dateRange: '2026-05-26 - 2026-05-31',
      printedAt,
      printedBy: input.printedBy || 'UserWho printed',
      rows: [
        {
          date: '2026-05-26',
          dow: 'MAR',
          dta: 0,
          occ: 13.1,
          pu7d: 1,
          adr: 413,
          revenue: 6603,
          tarifa: 1665,
          compSet: 1678,
          gap: -0.8,
          gapRank: 'Rank 3/5',
          rank: '3/5'
        },
        {
          date: '2026-05-27',
          dow: 'MIÉ',
          dta: 1,
          occ: 70.5,
          pu7d: 1,
          adr: 522,
          revenue: 44900,
          tarifa: 1665,
          compSet: 1676,
          gap: -0.7,
          gapRank: 'Rank 3/5',
          rank: '3/5'
        },
        {
          date: '2026-05-28',
          dow: 'JUE',
          dta: 2,
          occ: 70.5,
          pu7d: 1,
          adr: 523,
          revenue: 44957,
          tarifa: 1350,
          compSet: 1642,
          gap: -17.8,
          gapRank: 'Rank 2/5',
          rank: '2/5'
        },
        {
          date: '2026-05-31',
          dow: 'DOM',
          dta: 5,
          occ: 11.5,
          pu7d: 0,
          adr: 1296,
          revenue: 18151,
          tarifa: 1665,
          compSet: 1416,
          gap: 17.6,
          gapRank: 'Rank 4/5',
          rank: '4/5'
        }
      ]
    };
  }

  private async renderRevenueCalendarTemplate(
    context: RevenueCalendarTemplateContext
  ): Promise<string> {
    const templatePath = await this.resolveRevenueCalendarTemplatePath();
    const templateSource = await fs.readFile(templatePath, 'utf8');
    const template = Handlebars.compile(templateSource);
    return template(context);
  }

  private async resolveRevenueCalendarTemplatePath(): Promise<string> {
    const candidates = [
      path.join(process.cwd(), 'dist', 'src', 'reports', 'templates', 'revenue-calendar.hbs'),
      path.join(process.cwd(), 'dist', 'reports', 'templates', 'revenue-calendar.hbs'),
      path.join(process.cwd(), 'src', 'reports', 'templates', 'revenue-calendar.hbs')
    ];

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        continue;
      }
    }

    throw new NotFoundException('Revenue calendar template not found');
  }

  private buildRevenueCalendarFooterTemplate(context: RevenueCalendarTemplateContext): string {
    const printedAt = this.escapeHtml(context.printedAt);
    const printedBy = this.escapeHtml(context.printedBy);

    return `
      <div style="width:100%; padding:0 26px; font-family:Arial, Helvetica, sans-serif; font-size:10px; color:#394150;">
        <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
          <div style="width:33%; line-height:1.45;">
            <div>${printedAt}</div>
            <div>${printedBy}</div>
          </div>
          <div style="width:34%; text-align:center; font-size:11px;">
            Page <span class="pageNumber"></span> of <span class="totalPages"></span>
          </div>
          <div style="width:33%;"></div>
        </div>
      </div>
    `;
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (match) => {
      switch (match) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return match;
      }
    });
  }

  private formatPrintedAt(date: Date): string {
    return new Intl.DateTimeFormat('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  private buildFallbackRevenueCalendarPdf(context: RevenueCalendarTemplateContext): Buffer {
    const width = 792;
    const height = 612;
    const margin = 42;
    const contentLines: string[] = [];
    const title = context.title;
    const titleSize = 34;
    const subtitleSize = 16;
    const bodySize = 10;
    const headerTop = height - 72;
    const tableTop = height - 190;
    const rowHeight = 40;
    const tableLeft = 118;
    const tableRight = width - 48;
    const columns = [
      { key: 'date', label: 'FECHA', width: 76 },
      { key: 'dow', label: 'DOW', width: 50 },
      { key: 'dta', label: 'DTA', width: 40 },
      { key: 'occ', label: 'OCC', width: 54 },
      { key: 'pu7d', label: 'PU 7D', width: 54 },
      { key: 'adr', label: 'ADR', width: 72 },
      { key: 'revenue', label: 'REVENUE', width: 86 },
      { key: 'tarifa', label: 'TARIFA', width: 78 },
      { key: 'compSet', label: 'COMP SET', width: 86 },
      { key: 'gap', label: 'GAP', width: 56 },
      { key: 'rank', label: 'RANK', width: 44 }
    ] as const;

    const centerX = width / 2;
    const titleX = centerX - this.approxPdfTextWidth(title, titleSize) / 2;
    const hotelNameX = centerX - this.approxPdfTextWidth(context.hotelName, subtitleSize) / 2;
    const dateRangeX = width - 150;

    contentLines.push(this.pdfText('Rev', margin, headerTop + 4, 28, 'F2', '0.08 0.15 0.27'));
    contentLines.push(this.pdfText('Sight', margin + 32, headerTop + 4, 28, 'F2', '0.13 0.68 0.48'));
    contentLines.push(this.pdfText(title, titleX, headerTop + 10, titleSize, 'F1', '0.13 0.13 0.14'));
    contentLines.push(this.pdfText(context.hotelName, hotelNameX, headerTop - 18, subtitleSize, 'F1', '0.22 0.22 0.24'));
    contentLines.push(this.pdfText('Date Range', dateRangeX, headerTop - 16, 14, 'F1', '0.22 0.22 0.24'));
    contentLines.push(this.pdfLine(tableLeft, tableTop + 54, tableLeft, 92, '0.81 0.84 0.88', 1));

    let currentX = tableLeft + 12;
    for (const column of columns) {
      contentLines.push(
        this.pdfText(column.label, currentX, tableTop + 18, 10, 'F1', '0.39 0.42 0.46')
      );
      currentX += column.width;
    }

    context.rows.forEach((row, index) => {
      const rowTop = tableTop - index * rowHeight;
      const rowBottom = rowTop - rowHeight;
      if (index === 0) {
        contentLines.push(
          this.pdfRect(tableLeft + 1, rowBottom + 2, tableRight - tableLeft - 2, rowHeight - 4, '0.95 0.96 0.97')
        );
      }
      contentLines.push(
        this.pdfLine(tableLeft, rowBottom, tableRight, rowBottom, '0.84 0.86 0.9', 1)
      );

      let cellX = tableLeft + 12;
      const baseline = rowTop - 22;
      const valueColor = '0.15 0.16 0.17';
      const gapColor = row.gap > 0 ? '0.84 0.34 0.21' : '0.17 0.54 0.44';
      const rowValues = [
        row.date,
        row.dow,
        String(row.dta),
        `${row.occ.toFixed(1)}%`,
        String(row.pu7d),
        `MX$${row.adr.toLocaleString('en-US')}`,
        `MX$${row.revenue.toLocaleString('en-US')}`,
        `MX$${row.tarifa.toLocaleString('en-US')}`,
        `MX$${row.compSet.toLocaleString('en-US')}`,
        `${row.gap.toFixed(1)}%`,
        row.rank
      ];

      rowValues.forEach((value, valueIndex) => {
        const color = valueIndex === 9 ? gapColor : valueColor;
        contentLines.push(this.pdfText(value, cellX, baseline, bodySize, 'F2', color));
        if (valueIndex === 9) {
          contentLines.push(this.pdfText(row.gapRank, cellX, baseline - 11, 8, 'F1', '0.49 0.52 0.57'));
        }
        cellX += columns[valueIndex].width;
      });
    });

    contentLines.push(this.pdfText(context.printedAt, margin, 54, 10, 'F1', '0.2 0.2 0.22'));
    contentLines.push(this.pdfText(context.printedBy, margin, 38, 10, 'F1', '0.2 0.2 0.22'));
    contentLines.push(this.pdfText('Page 1 of 1', centerX - 28, 34, 12, 'F1', '0.2 0.2 0.22'));

    const content = contentLines.join('\n');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >> /Contents 4 0 R >>`,
      `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`
    ];

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

  private pdfText(
    text: string,
    x: number,
    y: number,
    size: number,
    font: 'F1' | 'F2',
    rgb: string
  ): string {
    return `BT /${font} ${size} Tf ${rgb} rg 1 0 0 1 ${x} ${y} Tm (${this.escapePdfText(text)}) Tj ET`;
  }

  private pdfLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    strokeRgb: string,
    lineWidth: number
  ): string {
    return `${strokeRgb} RG ${lineWidth} w ${x1} ${y1} m ${x2} ${y2} l S`;
  }

  private pdfRect(x: number, y: number, width: number, height: number, fillRgb: string): string {
    return `${fillRgb} rg ${x} ${y} ${width} ${height} re f`;
  }

  private approxPdfTextWidth(text: string, fontSize: number): number {
    return text.length * fontSize * 0.46;
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
}
