-- CreateTable
CREATE TABLE "CrsRoomRateDistributionSnapshot" (
    "id" SERIAL NOT NULL,
    "hotelId" INTEGER NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "criteriaStartDate" TIMESTAMP(3) NOT NULL,
    "criteriaEndDate" TIMESTAMP(3) NOT NULL,
    "criteriaWhichDate" TEXT NOT NULL,
    "criteriaShowGroups" TEXT NOT NULL DEFAULT 'NOT SPECIFIED',
    "criteriaCurrency" TEXT,
    "criteriaSections" TEXT,
    "criteriaChannels" TEXT,
    "criteriaUserLogin" TEXT,
    "reportExecutionTime" TIMESTAMP(3),
    "totalReservationCount" INTEGER NOT NULL,
    "totalRoomNights" INTEGER NOT NULL,
    "totalRevenue" DECIMAL(14,2) NOT NULL,
    "totalAdr" DECIMAL(10,2) NOT NULL,
    "sourceTotalLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrsRoomRateDistributionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrsRoomRateDistributionSnapshot_hotelId_criteriaStartDate_c_idx" ON "CrsRoomRateDistributionSnapshot"("hotelId", "criteriaStartDate", "criteriaEndDate");

-- CreateIndex
CREATE INDEX "CrsRoomRateDistributionSnapshot_hotelId_reportExecutionTime_idx" ON "CrsRoomRateDistributionSnapshot"("hotelId", "reportExecutionTime");

-- CreateIndex
CREATE UNIQUE INDEX "CrsRoomRateDistributionSnapshot_hotelId_criteriaStartDate_c_key" ON "CrsRoomRateDistributionSnapshot"("hotelId", "criteriaStartDate", "criteriaEndDate", "criteriaWhichDate", "criteriaShowGroups");

-- AddForeignKey
ALTER TABLE "CrsRoomRateDistributionSnapshot" ADD CONSTRAINT "CrsRoomRateDistributionSnapshot_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
