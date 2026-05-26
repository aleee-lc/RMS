-- CreateTable
CREATE TABLE "RateShopSnapshot" (
    "id" SERIAL NOT NULL,
    "hotelId" INTEGER NOT NULL,
    "competitorName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "checkInDate" TIMESTAMP(3) NOT NULL,
    "checkOutDate" TIMESTAMP(3) NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 2,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateShopSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateShopSnapshot_hotelId_checkInDate_scrapedAt_idx" ON "RateShopSnapshot"("hotelId", "checkInDate", "scrapedAt");

-- CreateIndex
CREATE INDEX "RateShopSnapshot_hotelId_competitorName_checkInDate_idx" ON "RateShopSnapshot"("hotelId", "competitorName", "checkInDate");

-- CreateIndex
CREATE INDEX "RateShopSnapshot_hotelId_source_checkInDate_idx" ON "RateShopSnapshot"("hotelId", "source", "checkInDate");

-- AddForeignKey
ALTER TABLE "RateShopSnapshot" ADD CONSTRAINT "RateShopSnapshot_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
