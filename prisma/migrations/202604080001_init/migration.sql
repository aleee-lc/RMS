-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "RecommendationAction" AS ENUM ('INCREASE', 'DECREASE', 'HOLD');

-- CreateTable
CREATE TABLE "Hotel" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totalRooms" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "timezone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hotel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationRaw" (
    "id" SERIAL NOT NULL,
    "hotelId" INTEGER NOT NULL,
    "reservationExternalId" TEXT NOT NULL,
    "bookingDate" TIMESTAMP(3) NOT NULL,
    "arrivalDate" TIMESTAMP(3) NOT NULL,
    "departureDate" TIMESTAMP(3),
    "nights" INTEGER NOT NULL DEFAULT 1,
    "noOfRooms" INTEGER NOT NULL DEFAULT 1,
    "roomRate" DECIMAL(10,2) NOT NULL,
    "sourceStatus" TEXT,
    "sourceUser" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationRaw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMetrics" (
    "id" SERIAL NOT NULL,
    "hotelId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "bookedRooms" INTEGER NOT NULL DEFAULT 0,
    "occupancy" DECIMAL(5,2) NOT NULL,
    "adr" DECIMAL(10,2) NOT NULL,
    "revenue" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketRates" (
    "id" SERIAL NOT NULL,
    "hotelId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "yourPrice" DECIMAL(10,2),
    "marketAverage" DECIMAL(10,2),
    "sourceFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketRates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" SERIAL NOT NULL,
    "hotelId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorMarketRates" (
    "id" SERIAL NOT NULL,
    "competitorId" INTEGER NOT NULL,
    "marketRateId" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorMarketRates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendations" (
    "id" SERIAL NOT NULL,
    "hotelId" INTEGER NOT NULL,
    "marketRateId" INTEGER,
    "date" TIMESTAMP(3) NOT NULL,
    "action" "RecommendationAction" NOT NULL,
    "suggestedPrice" DECIMAL(10,2) NOT NULL,
    "explanation" TEXT NOT NULL,
    "occupancy" DECIMAL(5,2),
    "yourPrice" DECIMAL(10,2),
    "marketAverage" DECIMAL(10,2),
    "priceDiffPct" DECIMAL(6,2),
    "demandFactor" DECIMAL(6,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alerts" (
    "id" SERIAL NOT NULL,
    "hotelId" INTEGER NOT NULL,
    "recommendationId" INTEGER,
    "date" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Hotel_code_key" ON "Hotel"("code");

-- CreateIndex
CREATE INDEX "Hotel_name_idx" ON "Hotel"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationRaw_hotelId_reservationExternalId_key" ON "ReservationRaw"("hotelId", "reservationExternalId");

-- CreateIndex
CREATE INDEX "ReservationRaw_hotelId_arrivalDate_idx" ON "ReservationRaw"("hotelId", "arrivalDate");

-- CreateIndex
CREATE INDEX "ReservationRaw_hotelId_bookingDate_idx" ON "ReservationRaw"("hotelId", "bookingDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMetrics_hotelId_date_key" ON "DailyMetrics"("hotelId", "date");

-- CreateIndex
CREATE INDEX "DailyMetrics_hotelId_date_idx" ON "DailyMetrics"("hotelId", "date");

-- CreateIndex
CREATE INDEX "DailyMetrics_date_idx" ON "DailyMetrics"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketRates_hotelId_date_key" ON "MarketRates"("hotelId", "date");

-- CreateIndex
CREATE INDEX "MarketRates_hotelId_date_idx" ON "MarketRates"("hotelId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Competitor_hotelId_name_key" ON "Competitor"("hotelId", "name");

-- CreateIndex
CREATE INDEX "Competitor_hotelId_idx" ON "Competitor"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorMarketRates_competitorId_marketRateId_key" ON "CompetitorMarketRates"("competitorId", "marketRateId");

-- CreateIndex
CREATE INDEX "CompetitorMarketRates_marketRateId_idx" ON "CompetitorMarketRates"("marketRateId");

-- CreateIndex
CREATE INDEX "CompetitorMarketRates_competitorId_idx" ON "CompetitorMarketRates"("competitorId");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendations_hotelId_date_key" ON "Recommendations"("hotelId", "date");

-- CreateIndex
CREATE INDEX "Recommendations_hotelId_date_idx" ON "Recommendations"("hotelId", "date");

-- CreateIndex
CREATE INDEX "Recommendations_action_idx" ON "Recommendations"("action");

-- CreateIndex
CREATE UNIQUE INDEX "Alerts_hotelId_date_type_key" ON "Alerts"("hotelId", "date", "type");

-- CreateIndex
CREATE INDEX "Alerts_hotelId_date_resolved_idx" ON "Alerts"("hotelId", "date", "resolved");

-- CreateIndex
CREATE INDEX "Alerts_severity_resolved_idx" ON "Alerts"("severity", "resolved");

-- AddForeignKey
ALTER TABLE "ReservationRaw" ADD CONSTRAINT "ReservationRaw_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMetrics" ADD CONSTRAINT "DailyMetrics_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketRates" ADD CONSTRAINT "MarketRates_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorMarketRates" ADD CONSTRAINT "CompetitorMarketRates_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorMarketRates" ADD CONSTRAINT "CompetitorMarketRates_marketRateId_fkey" FOREIGN KEY ("marketRateId") REFERENCES "MarketRates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendations" ADD CONSTRAINT "Recommendations_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendations" ADD CONSTRAINT "Recommendations_marketRateId_fkey" FOREIGN KEY ("marketRateId") REFERENCES "MarketRates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alerts" ADD CONSTRAINT "Alerts_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alerts" ADD CONSTRAINT "Alerts_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
