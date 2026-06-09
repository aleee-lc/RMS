export interface RatePlanListItem {
  id: number;
  code: string;
  name: string;
  marketSegment: string | null;
  pricingStandard: string | null;
  participationRequirement: string | null;
  derivedFromCode: string | null;
  discountMin: number | null;
  discountMax: number | null;
  mandatory: boolean | null;
  manageInCrsOnly: boolean | null;
  rewardsQualifying: boolean | null;
  commissionable: boolean | null;
  channels: Record<string, boolean> | null;
}

export interface RatePlanListResponse {
  count: number;
  items: RatePlanListItem[];
}

export interface RatePlanInsight {
  code: string;
  name: string;
  severity: 'high' | 'medium' | 'low';
  type: string;
  message: string;
}

export interface RatePlanInsightsResponse {
  summary: {
    totalRatePlans: number;
    derivedRatePlans: number;
    insightCount: number;
    latestImportAt: string | null;
    latestImportFile: string | null;
  };
  topMarketSegments: Array<{ label: string; count: number }>;
  topPricingStandards: Array<{ label: string; count: number }>;
  items: RatePlanInsight[];
}

export interface RatePlanDetail extends RatePlanListItem {
  region: string | null;
  country: string | null;
  sourceBrand: string | null;
  rateCategory: string | null;
  rateType: string | null;
  redemptionType: string | null;
  derivedFormula: string | null;
  roomTypeStandard: string | null;
  mirrorPoolAssignment: string | null;
  additionalInformation: string | null;
  descriptionShort: string | null;
  descriptionLong: string | null;
  pmsCode: string | null;
  pmsGroupCode: string | null;
  gdsCategory: string | null;
  sourceAssignment: string | null;
  comparisonType: string | null;
  targetRateType: string | null;
  inventoryRequired: number | null;
  sellLimit: number | null;
  minStayThru: number | null;
  maxStayThru: number | null;
  minLeadDays: number | null;
  maxLeadDays: number | null;
  defaultDiscountRecommendation: number | null;
  deriveOffsetAmount: number | null;
  adjustmentAmount: number | null;
  lra: boolean | null;
  children: Array<{
    id: number;
    code: string;
    name: string;
    marketSegment: string | null;
    pricingStandard: string | null;
  }>;
}

export interface RatePlanImportResult {
  importId: number;
  hotelId: number;
  sourceFile: string;
  sourceBrand: string | null;
  rowsParsed: number;
  ratePlansUpserted: number;
  sheetSummary: {
    sheets: Array<{ name: string; rows: number; columns: number }>;
  };
  insightsPreview: RatePlanInsight[];
}
