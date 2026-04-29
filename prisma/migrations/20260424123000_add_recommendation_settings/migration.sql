-- CreateTable
CREATE TABLE "RecommendationSettings" (
    "id" SERIAL NOT NULL,
    "hotelId" INTEGER NOT NULL,
    "highOccupancyThreshold" DECIMAL(5,2) NOT NULL,
    "lowOccupancyThreshold" DECIMAL(5,2) NOT NULL,
    "significantDiffPct" DECIMAL(6,2) NOT NULL,
    "demandWeight" DECIMAL(6,4) NOT NULL,
    "marketWeight" DECIMAL(6,4) NOT NULL,
    "maxAdjustmentPct" DECIMAL(6,2) NOT NULL,
    "minActionStepPct" DECIMAL(6,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationSettings_hotelId_key" ON "RecommendationSettings"("hotelId");

-- CreateIndex
CREATE INDEX "RecommendationSettings_hotelId_updatedAt_idx" ON "RecommendationSettings"("hotelId", "updatedAt");

-- AddForeignKey
ALTER TABLE "RecommendationSettings" ADD CONSTRAINT "RecommendationSettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
