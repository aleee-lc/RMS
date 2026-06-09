-- CreateTable
CREATE TABLE "RatePlanImport" (
    "id" SERIAL NOT NULL,
    "hotelId" INTEGER NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "sourceBrand" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowsParsed" INTEGER NOT NULL DEFAULT 0,
    "ratePlansUpserted" INTEGER NOT NULL DEFAULT 0,
    "sheetSummary" JSONB,

    CONSTRAINT "RatePlanImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatePlan" (
    "id" SERIAL NOT NULL,
    "hotelId" INTEGER NOT NULL,
    "importId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "country" TEXT,
    "sourceBrand" TEXT,
    "rateCategory" TEXT,
    "rateType" TEXT,
    "redemptionType" TEXT,
    "marketSegment" TEXT,
    "pricingStandard" TEXT,
    "participationRequirement" TEXT,
    "derivedFromCode" TEXT,
    "derivedFormula" TEXT,
    "roomTypeStandard" TEXT,
    "mirrorPoolAssignment" TEXT,
    "additionalInformation" TEXT,
    "descriptionShort" TEXT,
    "descriptionLong" TEXT,
    "pmsCode" TEXT,
    "pmsGroupCode" TEXT,
    "gdsCategory" TEXT,
    "sourceAssignment" TEXT,
    "comparisonType" TEXT,
    "targetRateType" TEXT,
    "inventoryRequired" INTEGER,
    "sellLimit" INTEGER,
    "minStayThru" INTEGER,
    "maxStayThru" INTEGER,
    "minLeadDays" INTEGER,
    "maxLeadDays" INTEGER,
    "discountMin" DECIMAL(10,2),
    "discountMax" DECIMAL(10,2),
    "defaultDiscountRecommendation" DECIMAL(10,2),
    "deriveOffsetAmount" DECIMAL(10,2),
    "adjustmentAmount" DECIMAL(10,2),
    "rewardsQualifying" BOOLEAN,
    "mandatory" BOOLEAN,
    "manageInCrsOnly" BOOLEAN,
    "commissionable" BOOLEAN,
    "lra" BOOLEAN,
    "channels" JSONB,
    "rawAbbreviated" JSONB,
    "rawDefined" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RatePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RatePlanImport_hotelId_importedAt_idx" ON "RatePlanImport"("hotelId", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RatePlan_hotelId_code_key" ON "RatePlan"("hotelId", "code");

-- CreateIndex
CREATE INDEX "RatePlan_hotelId_marketSegment_idx" ON "RatePlan"("hotelId", "marketSegment");

-- CreateIndex
CREATE INDEX "RatePlan_hotelId_pricingStandard_idx" ON "RatePlan"("hotelId", "pricingStandard");

-- CreateIndex
CREATE INDEX "RatePlan_hotelId_derivedFromCode_idx" ON "RatePlan"("hotelId", "derivedFromCode");

-- CreateIndex
CREATE INDEX "RatePlan_hotelId_importId_idx" ON "RatePlan"("hotelId", "importId");

-- AddForeignKey
ALTER TABLE "RatePlanImport" ADD CONSTRAINT "RatePlanImport_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatePlan" ADD CONSTRAINT "RatePlan_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatePlan" ADD CONSTRAINT "RatePlan_importId_fkey" FOREIGN KEY ("importId") REFERENCES "RatePlanImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
