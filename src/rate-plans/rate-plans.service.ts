import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { RatePlanQueryDto } from './dto/rate-plan-query.dto';

type ParsedSheetRow = Record<string, string | number | boolean | null>;

interface ParsedRatePlanRow {
  code: string;
  name: string;
  abbreviated: ParsedSheetRow | null;
  defined: ParsedSheetRow | null;
}

interface InsightItem {
  code: string;
  name: string;
  severity: 'high' | 'medium' | 'low';
  type: string;
  message: string;
}

@Injectable()
export class RatePlansService {
  constructor(private readonly prisma: PrismaService) {}

  async importMasterWorkbook(hotelId: number, fileName: string, fileBuffer: Buffer) {
    await this.assertHotelExists(hotelId);

    const workbook = new ExcelJS.Workbook();
    const payload = fileBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(payload);

    const parsed = this.parseWorkbook(workbook);
    if (parsed.rows.length === 0) {
      throw new BadRequestException(
        'El archivo no contiene rate plans legibles en las hojas esperadas.'
      );
    }

    const insightsPreview = this.buildInsightsFromRows(parsed.rows).slice(0, 8);

    const result = await this.prisma.$transaction(async (tx) => {
      const ratePlanImport = await tx.ratePlanImport.create({
        data: {
          hotelId,
          sourceFile: fileName,
          sourceBrand: parsed.sourceBrand,
          rowsParsed: parsed.rows.length,
          ratePlansUpserted: parsed.rows.length,
          sheetSummary: parsed.sheetSummary as Prisma.InputJsonValue
        }
      });

      await tx.ratePlan.deleteMany({
        where: { hotelId }
      });

      if (parsed.rows.length > 0) {
        await tx.ratePlan.createMany({
          data: parsed.rows.map((row) =>
            this.toCreateInput(hotelId, ratePlanImport.id, parsed.sourceBrand, row)
          )
        });
      }

      return ratePlanImport;
    });

    return {
      importId: result.id,
      hotelId,
      sourceFile: fileName,
      sourceBrand: parsed.sourceBrand,
      rowsParsed: parsed.rows.length,
      ratePlansUpserted: parsed.rows.length,
      sheetSummary: parsed.sheetSummary,
      insightsPreview
    };
  }

  async listRatePlans(hotelId: number, query: RatePlanQueryDto) {
    await this.assertHotelExists(hotelId);

    const where: Prisma.RatePlanWhereInput = {
      hotelId
    };

    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { marketSegment: { contains: search, mode: 'insensitive' } },
        { derivedFromCode: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (query.marketSegment?.trim()) {
      where.marketSegment = query.marketSegment.trim();
    }

    if (query.pricingStandard?.trim()) {
      where.pricingStandard = query.pricingStandard.trim();
    }

    if (query.participationRequirement?.trim()) {
      where.participationRequirement = query.participationRequirement.trim();
    }

    if (query.derivedOnly) {
      where.NOT = [{ derivedFromCode: null }, { derivedFromCode: '' }];
    }

    const limit = Math.min(query.limit ?? 250, 500);
    const items = await this.prisma.ratePlan.findMany({
      where,
      orderBy: [{ marketSegment: 'asc' }, { code: 'asc' }],
      take: limit,
      select: {
        id: true,
        code: true,
        name: true,
        marketSegment: true,
        pricingStandard: true,
        participationRequirement: true,
        derivedFromCode: true,
        discountMin: true,
        discountMax: true,
        mandatory: true,
        manageInCrsOnly: true,
        rewardsQualifying: true,
        commissionable: true,
        channels: true
      }
    });

    return {
      count: items.length,
      items: items.map((item) => ({
        ...item,
        discountMin: item.discountMin ? Number(item.discountMin) : null,
        discountMax: item.discountMax ? Number(item.discountMax) : null
      }))
    };
  }

  async getRatePlanById(hotelId: number, id: number) {
    await this.assertHotelExists(hotelId);

    const item = await this.prisma.ratePlan.findFirst({
      where: {
        id,
        hotelId
      }
    });

    if (!item) {
      throw new NotFoundException(`Rate plan ${id} no existe para el hotel ${hotelId}`);
    }

    const children = await this.prisma.ratePlan.findMany({
      where: {
        hotelId,
        derivedFromCode: item.code
      },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        marketSegment: true,
        pricingStandard: true
      }
    });

    return {
      ...item,
      discountMin: item.discountMin ? Number(item.discountMin) : null,
      discountMax: item.discountMax ? Number(item.discountMax) : null,
      defaultDiscountRecommendation: item.defaultDiscountRecommendation
        ? Number(item.defaultDiscountRecommendation)
        : null,
      deriveOffsetAmount: item.deriveOffsetAmount ? Number(item.deriveOffsetAmount) : null,
      adjustmentAmount: item.adjustmentAmount ? Number(item.adjustmentAmount) : null,
      children
    };
  }

  async getInsights(hotelId: number) {
    await this.assertHotelExists(hotelId);

    const [latestImport, ratePlans] = await Promise.all([
      this.prisma.ratePlanImport.findFirst({
        where: { hotelId },
        orderBy: { importedAt: 'desc' }
      }),
      this.prisma.ratePlan.findMany({
        where: { hotelId },
        select: {
          id: true,
          code: true,
          name: true,
          marketSegment: true,
          pricingStandard: true,
          participationRequirement: true,
          derivedFromCode: true,
          discountMin: true,
          discountMax: true,
          sourceAssignment: true
        }
      })
    ]);

    const insightItems = this.buildInsightsFromPersisted(ratePlans);
    const segments = new Map<string, number>();
    const pricingStandards = new Map<string, number>();

    for (const item of ratePlans) {
      if (item.marketSegment) {
        segments.set(item.marketSegment, (segments.get(item.marketSegment) ?? 0) + 1);
      }
      if (item.pricingStandard) {
        pricingStandards.set(item.pricingStandard, (pricingStandards.get(item.pricingStandard) ?? 0) + 1);
      }
    }

    return {
      summary: {
        totalRatePlans: ratePlans.length,
        derivedRatePlans: ratePlans.filter((item) => item.derivedFromCode).length,
        insightCount: insightItems.length,
        latestImportAt: latestImport?.importedAt ?? null,
        latestImportFile: latestImport?.sourceFile ?? null
      },
      topMarketSegments: [...segments.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([label, count]) => ({ label, count })),
      topPricingStandards: [...pricingStandards.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([label, count]) => ({ label, count })),
      items: insightItems
    };
  }

  private parseWorkbook(workbook: ExcelJS.Workbook): {
    sourceBrand: string | null;
    rows: ParsedRatePlanRow[];
    sheetSummary: Record<string, unknown>;
  } {
    const abbreviatedSheet = workbook.getWorksheet(' Abbreviated RPM');
    const definedSheet = workbook.getWorksheet('WHR Defined');

    if (!abbreviatedSheet || !definedSheet) {
      throw new BadRequestException(
        'El Excel debe incluir las hojas " Abbreviated RPM" y "WHR Defined".'
      );
    }

    const sourceBrand = this.toNullableString(abbreviatedSheet.getRow(1).getCell(2).value)
      ?? this.toNullableString(abbreviatedSheet.getRow(1).getCell(1).value)
      ?? this.toNullableString(definedSheet.getRow(1).getCell(1).value);

    const abbreviatedHeaders = this.readHeaders(abbreviatedSheet, 2);
    const definedHeaders = this.readHeaders(definedSheet, 5);
    const abbreviatedRows = this.readSheetRows(abbreviatedSheet, 3, abbreviatedHeaders, 'Rate Plan\n');
    const definedRows = this.readSheetRows(definedSheet, 6, definedHeaders, 'Code');

    const definedByCode = new Map<string, ParsedSheetRow>(
      definedRows.map((row) => [String(row['Code']).trim().toUpperCase(), row])
    );

    const seenCodes = new Set<string>();
    const rows: ParsedRatePlanRow[] = [];

    for (const abbreviated of abbreviatedRows) {
      const code = String(abbreviated['Rate Plan\n']).trim().toUpperCase();
      if (!code || seenCodes.has(code)) {
        continue;
      }

      seenCodes.add(code);
      rows.push({
        code,
        name:
          this.toNullableString(abbreviated['Rate Code Name']) ??
          this.toNullableString(definedByCode.get(code)?.['Rate Code Name']) ??
          code,
        abbreviated,
        defined: definedByCode.get(code) ?? null
      });
    }

    for (const defined of definedRows) {
      const code = String(defined['Code']).trim().toUpperCase();
      if (!code || seenCodes.has(code)) {
        continue;
      }

      seenCodes.add(code);
      rows.push({
        code,
        name: this.toNullableString(defined['Rate Code Name']) ?? code,
        abbreviated: null,
        defined
      });
    }

    return {
      sourceBrand,
      rows,
      sheetSummary: {
        sheets: [
          { name: abbreviatedSheet.name, rows: abbreviatedRows.length, columns: abbreviatedHeaders.length },
          { name: definedSheet.name, rows: definedRows.length, columns: definedHeaders.length }
        ]
      }
    };
  }

  private readHeaders(sheet: ExcelJS.Worksheet, rowNumber: number): Array<string | null> {
    const row = sheet.getRow(rowNumber);
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    return values.map((value: ExcelJS.CellValue) => this.toHeaderString(value));
  }

  private readSheetRows(
    sheet: ExcelJS.Worksheet,
    startRow: number,
    headers: Array<string | null>,
    codeHeader: string
  ): ParsedSheetRow[] {
    const rows: ParsedSheetRow[] = [];

    for (let rowNumber = startRow; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const mapped: ParsedSheetRow = {};

      headers.forEach((header, index) => {
        if (!header) {
          return;
        }
        mapped[header] = this.normalizeCellValue(row.getCell(index + 1).value);
      });

      const code = this.toNullableString(mapped[codeHeader]);
      if (!code) {
        continue;
      }

      rows.push(mapped);
    }

    return rows;
  }

  private toCreateInput(
    hotelId: number,
    importId: number,
    sourceBrand: string | null,
    row: ParsedRatePlanRow
  ): Prisma.RatePlanCreateManyInput {
    const abbreviated = row.abbreviated ?? {};
    const defined = row.defined ?? {};

    const minLeadDays = this.firstInt(defined['Advance Purchase - Min Lead Days* Min']);

    return {
      hotelId,
      importId,
      code: row.code,
      name: row.name,
      region: this.pickString(abbreviated['Region'], defined['Region']),
      country: this.pickString(abbreviated['Country'], defined['Country']),
      sourceBrand,
      rateCategory: this.pickString(abbreviated['Rate Category\n'], defined['Rate Category']),
      rateType: this.pickString(defined['Type*']),
      redemptionType: this.pickString(abbreviated['Redemption Type'], defined['Redemption Type']),
      marketSegment: this.pickString(abbreviated['Market Segment\n'], defined['Segment']),
      pricingStandard: this.pickString(abbreviated['Pricing Standard\n']),
      participationRequirement: this.pickString(abbreviated['Participation Requirement\n']),
      derivedFromCode: this.pickString(
        abbreviated['Derived From Rate Plan\n'],
        defined['Derive From - Rate Plan']
      ),
      derivedFormula: this.pickString(defined['Derived Formula*']),
      roomTypeStandard: this.pickString(
        abbreviated['Room Type Standards (minimum)\n'],
        defined['Room Type Selection (Minimum Standard)']
      ),
      mirrorPoolAssignment: this.pickString(abbreviated['Mirror Pool Assigment\n']),
      additionalInformation: this.pickString(
        abbreviated['Additional Information for Hotels\n'],
        defined['Additional Information for Hotels']
      ),
      descriptionShort: this.pickString(defined['Default Short Description*']),
      descriptionLong: this.pickString(abbreviated['Description\n'], defined['Default Long Description']),
      pmsCode: this.pickString(defined['PMS Code*\n(Varies by PM System)*']),
      pmsGroupCode: this.pickString(defined['PMS Group Code*']),
      gdsCategory: this.pickString(defined['Class \n(GDS Category) *']),
      sourceAssignment: this.pickString(defined['Source*']),
      comparisonType: this.pickString(defined['Comparison Type*']),
      targetRateType: this.pickString(defined['Target Rate Type*']),
      inventoryRequired: this.firstInt(
        abbreviated['100% Inventory Required\n'],
        defined['Inventory - Sell Limit']
      ),
      sellLimit: this.firstInt(defined['Sell Limit*'], defined['Inventory - Sell Limit']),
      minStayThru: this.firstInt(
        defined['Min Stay Thru*'],
        defined['Length of Stay - Min Stay Thru*']
      ),
      maxStayThru: this.firstInt(
        defined['Max Stay Thru*'],
        defined['Length of Stay - Max Stay Thru*']
      ),
      minLeadDays,
      maxLeadDays: this.firstInt(
        defined['Max Lead Days*'],
        defined['Advance Purchase - Max Lead Days*']
      ),
      discountMin: this.firstDecimal(abbreviated['Discount Min']),
      discountMax: this.firstDecimal(abbreviated['Discount Max\n']),
      defaultDiscountRecommendation: this.firstDecimal(
        abbreviated['Default Discount Recommendation'],
        defined['Default Discount Recommendation']
      ),
      deriveOffsetAmount: this.firstDecimal(defined['Derive Offset Calculation Amount*']),
      adjustmentAmount: this.firstDecimal(defined['Adjustment Amount*'], defined['Adjustment*']),
      rewardsQualifying: this.firstBoolean(abbreviated['Wyndham Rewards Qualifying\n']),
      mandatory: this.firstBoolean(abbreviated['Mandatory\n'], defined['Mandatory']),
      manageInCrsOnly: this.firstBoolean(
        abbreviated['Manage in CRS Only Settings\n'],
        defined['Managed in CRS Only']
      ),
      commissionable: this.firstBoolean(
        abbreviated['Commissionable\nReference'],
        defined['Commissionable']
      ),
      lra: this.firstBoolean(abbreviated['LRA\n']),
      channels: this.extractChannels(defined) as Prisma.InputJsonValue,
      rawAbbreviated: abbreviated as Prisma.InputJsonValue,
      rawDefined: defined as Prisma.InputJsonValue
    };
  }

  private buildInsightsFromPersisted(
    items: Array<{
      code: string;
      name: string;
      marketSegment: string | null;
      pricingStandard: string | null;
      participationRequirement: string | null;
      derivedFromCode: string | null;
      discountMin: Prisma.Decimal | null;
      discountMax: Prisma.Decimal | null;
      sourceAssignment: string | null;
    }>
  ): InsightItem[] {
    const codeSet = new Set(items.map((item) => item.code));
    const insights: InsightItem[] = [];

    for (const item of items) {
      if (item.derivedFromCode && !codeSet.has(item.derivedFromCode)) {
        insights.push({
          code: item.code,
          name: item.name,
          severity: 'high',
          type: 'missing-derived-parent',
          message: `Deriva de ${item.derivedFromCode}, pero ese rate plan no existe en el catálogo cargado.`
        });
      }

      const discountMin = item.discountMin ? Number(item.discountMin) : null;
      const discountMax = item.discountMax ? Number(item.discountMax) : null;

      if (discountMin !== null && discountMax !== null && discountMin > discountMax) {
        insights.push({
          code: item.code,
          name: item.name,
          severity: 'high',
          type: 'invalid-discount-range',
          message: `El rango de descuento es inconsistente: min ${discountMin}% mayor que max ${discountMax}%.`
        });
      }

      if (discountMin !== null && discountMax !== null && Math.abs(discountMax - discountMin) >= 15) {
        insights.push({
          code: item.code,
          name: item.name,
          severity: 'medium',
          type: 'wide-discount-window',
          message: `Tiene una ventana de descuento amplia (${discountMin}% a ${discountMax}%), conviene revisar gobernanza comercial.`
        });
      }

      if (!item.marketSegment) {
        insights.push({
          code: item.code,
          name: item.name,
          severity: 'medium',
          type: 'missing-segment',
          message: 'No tiene market segment definido, lo que dificulta el control comercial.'
        });
      }

      if (item.pricingStandard === 'Property Discretion') {
        insights.push({
          code: item.code,
          name: item.name,
          severity: 'low',
          type: 'property-discretion',
          message: 'Queda a discreción de la propiedad; conviene documentar la regla operativa esperada.'
        });
      }

      if (!item.sourceAssignment && item.marketSegment?.toLowerCase().includes('ota')) {
        insights.push({
          code: item.code,
          name: item.name,
          severity: 'medium',
          type: 'missing-source-assignment',
          message: 'Parece rate de distribución OTA, pero no trae source assignment claro en el master.'
        });
      }
    }

    return insights.sort((a, b) => this.severityWeight(b.severity) - this.severityWeight(a.severity));
  }

  private buildInsightsFromRows(rows: ParsedRatePlanRow[]): InsightItem[] {
    const projected = rows.map((row) => ({
      code: row.code,
      name: row.name,
      marketSegment: this.pickString(row.abbreviated?.['Market Segment\n'], row.defined?.['Segment']),
      pricingStandard: this.pickString(row.abbreviated?.['Pricing Standard\n']),
      participationRequirement: this.pickString(row.abbreviated?.['Participation Requirement\n']),
      derivedFromCode: this.pickString(
        row.abbreviated?.['Derived From Rate Plan\n'],
        row.defined?.['Derive From - Rate Plan']
      ),
      discountMin: this.firstDecimal(row.abbreviated?.['Discount Min']),
      discountMax: this.firstDecimal(row.abbreviated?.['Discount Max\n']),
      sourceAssignment: this.pickString(row.defined?.['Source*'])
    }));

    return this.buildInsightsFromPersisted(
      projected.map((item) => ({
        ...item,
        discountMin: item.discountMin === null ? null : new Prisma.Decimal(item.discountMin),
        discountMax: item.discountMax === null ? null : new Prisma.Decimal(item.discountMax)
      }))
    );
  }

  private extractChannels(row: ParsedSheetRow): Record<string, boolean> {
    const channels: Record<string, boolean> = {};
    const mapping: Array<[string, string]> = [
      ['PMS*', 'pms'],
      ['Booking Engine*', 'bookingEngine'],
      ['Mobile Web*', 'mobileWeb'],
      ['Voice*', 'voice'],
      ['Property Direct*', 'propertyDirect'],
      ['GDS*', 'gds'],
      ['IDS*', 'ids'],
      ['Channel Connect*', 'channelConnect']
    ];

    for (const [header, key] of mapping) {
      const value = this.firstBoolean(row[header]);
      if (value !== null) {
        channels[key] = value;
      }
    }

    return channels;
  }

  private severityWeight(severity: InsightItem['severity']): number {
    return severity === 'high' ? 3 : severity === 'medium' ? 2 : 1;
  }

  private pickString(...values: Array<string | number | boolean | null | undefined>): string | null {
    for (const value of values) {
      const normalized = this.toNullableString(value);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  private firstInt(...values: Array<string | number | boolean | null | undefined>): number | null {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.round(value);
      }
      const parsed = this.toNullableString(value);
      if (parsed && /^-?\d+(\.\d+)?$/.test(parsed)) {
        return Math.round(Number(parsed));
      }
    }
    return null;
  }

  private firstDecimal(...values: Array<string | number | boolean | null | undefined>): number | null {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      const parsed = this.toNullableString(value);
      if (parsed && /^-?\d+(\.\d+)?$/.test(parsed)) {
        return Number(parsed);
      }
    }
    return null;
  }

  private firstBoolean(...values: Array<string | number | boolean | null | undefined>): boolean | null {
    for (const value of values) {
      if (typeof value === 'boolean') {
        return value;
      }

      const normalized = this.toNullableString(value)?.toLowerCase();
      if (!normalized) {
        continue;
      }

      if (['yes', 'true', 'check', 'checked', 'y'].includes(normalized)) {
        return true;
      }

      if (['no', 'false', 'uncheck', 'unchecked', 'n'].includes(normalized)) {
        return false;
      }
    }
    return null;
  }

  private normalizeCellValue(value: ExcelJS.CellValue): string | number | boolean | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string') {
      return this.toNullableString(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') {
      return this.toNullableString(value.text);
    }

    return this.toNullableString(String(value));
  }

  private toHeaderString(value: ExcelJS.CellValue): string | null {
    const normalized = this.normalizeCellValue(value);
    return normalized === null ? null : String(normalized);
  }

  private toNullableString(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const normalized = String(value).replace(/_x000D_/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.toLowerCase() === 'null') {
      return null;
    }

    return normalized;
  }

  private async assertHotelExists(hotelId: number): Promise<void> {
    const hotel = await this.prisma.hotel.findUnique({
      where: { id: hotelId },
      select: { id: true }
    });

    if (!hotel) {
      throw new NotFoundException(`Hotel ${hotelId} no existe`);
    }
  }
}
