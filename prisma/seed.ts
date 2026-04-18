import 'dotenv/config';
import { PrismaClient, RecommendationAction, AlertSeverity } from '@prisma/client';

const prisma = new PrismaClient();

function toUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main() {
  const hotelCode = process.env.DEFAULT_HOTEL_CODE ?? 'WGLM';
  const hotelName = process.env.DEFAULT_HOTEL_NAME ?? 'Wyndham Garden Los Mochis Plaza Inn';
  const totalRooms = Number(process.env.DEFAULT_HOTEL_TOTAL_ROOMS ?? 100);

  const hotel = await prisma.hotel.upsert({
    where: { code: hotelCode },
    update: { name: hotelName, totalRooms },
    create: {
      code: hotelCode,
      name: hotelName,
      totalRooms,
      currency: 'MXN',
      timezone: 'America/Chihuahua'
    }
  });

  const competitorNames = [
    'Best Western Plus Los Mochis',
    'City Express by Marriott Los Mochis',
    'Fiesta Inn Los Mochis',
    'Ibis Los Mochis'
  ];

  for (const name of competitorNames) {
    await prisma.competitor.upsert({
      where: { hotelId_name: { hotelId: hotel.id, name } },
      update: {},
      create: { hotelId: hotel.id, name }
    });
  }

  const start = toUtcDate(2026, 4, 1);
  const metricsDays = 30;

  for (let i = 0; i < metricsDays; i += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);

    const occupancy = Math.min(92, Math.max(18, 52 + Math.sin(i / 3) * 24));
    const bookedRooms = Math.round((occupancy / 100) * totalRooms);
    const adr = round2(1180 + Math.cos(i / 4) * 140);
    const revenue = round2(adr * bookedRooms);

    await prisma.dailyMetrics.upsert({
      where: { hotelId_date: { hotelId: hotel.id, date } },
      update: { occupancy, bookedRooms, adr, revenue },
      create: { hotelId: hotel.id, date, occupancy, bookedRooms, adr, revenue }
    });

    const marketAverage = round2(adr + Math.sin(i / 5) * 90);
    const yourPrice = round2(adr + Math.cos(i / 5) * 65);

    await prisma.marketRates.upsert({
      where: { hotelId_date: { hotelId: hotel.id, date } },
      update: { yourPrice, marketAverage, sourceFile: 'seed' },
      create: {
        hotelId: hotel.id,
        date,
        yourPrice,
        marketAverage,
        sourceFile: 'seed'
      }
    });
  }

  const marketRates = await prisma.marketRates.findMany({
    where: { hotelId: hotel.id, date: { gte: start } },
    orderBy: { date: 'asc' },
    take: metricsDays
  });

  const metricsByDate = new Map(
    (
      await prisma.dailyMetrics.findMany({
        where: { hotelId: hotel.id, date: { gte: start } },
        orderBy: { date: 'asc' },
        take: metricsDays
      })
    ).map((m) => [m.date.toISOString().slice(0, 10), m])
  );

  for (const mr of marketRates) {
    const dayKey = mr.date.toISOString().slice(0, 10);
    const metric = metricsByDate.get(dayKey);

    const occupancy = metric ? Number(metric.occupancy) : 0;
    const yourPrice = Number(mr.yourPrice ?? 0);
    const marketAverage = Number(mr.marketAverage ?? 0);

    const priceDiffPct =
      marketAverage > 0 ? ((yourPrice - marketAverage) / marketAverage) * 100 : 0;

    let action: RecommendationAction = RecommendationAction.HOLD;
    if (occupancy > 70 && priceDiffPct < -10) action = RecommendationAction.INCREASE;
    if (occupancy < 30 && priceDiffPct > 10) action = RecommendationAction.DECREASE;

    const demandFactor = (occupancy - 50) / 100;
    const suggestedPrice = round2(
      yourPrice *
        (1 + Math.max(-0.15, Math.min(0.15, demandFactor * 0.4 + (priceDiffPct / 100) * -0.3)))
    );

    const recommendation = await prisma.recommendations.upsert({
      where: { hotelId_date: { hotelId: hotel.id, date: mr.date } },
      update: {
        marketRateId: mr.id,
        action,
        suggestedPrice,
        explanation: `Occupancy ${occupancy.toFixed(1)}% and price gap ${priceDiffPct.toFixed(1)}% vs market average drove a ${action.toLowerCase()} recommendation.`,
        occupancy,
        yourPrice,
        marketAverage,
        priceDiffPct,
        demandFactor
      },
      create: {
        hotelId: hotel.id,
        marketRateId: mr.id,
        date: mr.date,
        action,
        suggestedPrice,
        explanation: `Occupancy ${occupancy.toFixed(1)}% and price gap ${priceDiffPct.toFixed(1)}% vs market average drove a ${action.toLowerCase()} recommendation.`,
        occupancy,
        yourPrice,
        marketAverage,
        priceDiffPct,
        demandFactor
      }
    });

    if (action !== RecommendationAction.HOLD) {
      const severity =
        action === RecommendationAction.INCREASE ? AlertSeverity.HIGH : AlertSeverity.MEDIUM;
      await prisma.alerts.upsert({
        where: {
          hotelId_date_type: {
            hotelId: hotel.id,
            date: mr.date,
            type: 'pricing-opportunity'
          }
        },
        update: {
          recommendationId: recommendation.id,
          severity,
          title: `${action} pricing opportunity`,
          message: recommendation.explanation,
          resolved: false
        },
        create: {
          hotelId: hotel.id,
          recommendationId: recommendation.id,
          date: mr.date,
          type: 'pricing-opportunity',
          severity,
          title: `${action} pricing opportunity`,
          message: recommendation.explanation,
          resolved: false
        }
      });
    }
  }

  console.log(`Seed complete for hotel ${hotel.name} (id=${hotel.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
