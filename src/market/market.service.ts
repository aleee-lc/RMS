import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { dateKey, toUtcDateOnly } from '../common/utils/date.util';
import { round2, toNumber } from '../common/utils/number.util';

interface ParsedPriceRow {
  rowIndex: number;
  label: string;
  valuesByColumn: Map<number, number>;
}

@Injectable()
export class MarketService {
  private readonly monthMap: Record<string, number> = {
    JANUARY: 1,
    FEBRUARY: 2,
    MARCH: 3,
    APRIL: 4,
    MAY: 5,
    JUNE: 6,
    JULY: 7,
    AUGUST: 8,
    SEPTEMBER: 9,
    OCTOBER: 10,
    NOVEMBER: 11,
    DECEMBER: 12
  };

  constructor(private readonly prisma: PrismaService) {}

  async ingestExpediaGrid(
    hotelId: number,
    fileName: string,
    fileBuffer: Buffer
  ): Promise<{
    hotelRow: string;
    marketAverageRow: string | null;
    datesProcessed: number;
    dateRange: { start: string; end: string } | null;
    competitorsUpserted: number;
    marketRatesUpserted: number;
    competitorRatesUpserted: number;
  }> {
    const workbook = new ExcelJS.Workbook();
    await (workbook.xlsx as any).load(fileBuffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException('Excel workbook has no worksheets');
    }

    const dateColumns = this.parseDateColumns(sheet);
    if (dateColumns.size === 0) {
      throw new BadRequestException('Could not infer any valid date columns from Expedia workbook');
    }

    const priceRows = this.parsePriceRows(sheet, dateColumns);
    if (priceRows.length === 0) {
      throw new BadRequestException('No price rows found in Expedia workbook');
    }

    const hotelRow = priceRows[0];
    const marketAverageRow = this.pickMarketAverageRow(priceRows);

    const competitorRows = priceRows.filter((row) => {
      if (row.rowIndex === hotelRow.rowIndex) return false;
      if (marketAverageRow && row.rowIndex === marketAverageRow.rowIndex) return false;
      if (/competitive\s*set\s*average(?:\s*rates)?/i.test(row.label)) return false;
      if (/search demand|previous year|rest of/i.test(row.label)) return false;
      return true;
    });

    const competitors = await Promise.all(
      competitorRows.map((competitor) =>
        this.prisma.competitor.upsert({
          where: {
            hotelId_name: {
              hotelId,
              name: competitor.label
            }
          },
          update: {},
          create: {
            hotelId,
            name: competitor.label
          }
        })
      )
    );

    const competitorMap = new Map<string, number>(
      competitors.map((competitor) => [competitor.name, competitor.id])
    );

    const sortedColumns = [...dateColumns.entries()].sort((a, b) => a[0] - b[0]);
    const marketRateInputs = sortedColumns
      .map(([columnIndex, date]) => {
        const yourPrice = hotelRow.valuesByColumn.get(columnIndex) ?? null;
        const explicitMarketAverage = marketAverageRow?.valuesByColumn.get(columnIndex) ?? null;

        const competitorValues = competitorRows
          .map((row) => row.valuesByColumn.get(columnIndex))
          .filter((value): value is number => typeof value === 'number');

        const inferredAverage =
          competitorValues.length > 0
            ? round2(
                competitorValues.reduce((sum, value) => sum + value, 0) / competitorValues.length
              )
            : null;

        const marketAverage = explicitMarketAverage ?? inferredAverage;

        if (yourPrice === null && marketAverage === null && competitorValues.length === 0) {
          return null;
        }

        return {
          columnIndex,
          date,
          yourPrice,
          marketAverage
        };
      })
      .filter(
        (
          input
        ): input is {
          columnIndex: number;
          date: Date;
          yourPrice: number | null;
          marketAverage: number | null;
        } => input !== null
      );

    const marketRates = await Promise.all(
      marketRateInputs.map((input) =>
        this.prisma.marketRates.upsert({
          where: {
            hotelId_date: {
              hotelId,
              date: input.date
            }
          },
          update: {
            yourPrice: input.yourPrice,
            marketAverage: input.marketAverage,
            sourceFile: fileName
          },
          create: {
            hotelId,
            date: input.date,
            yourPrice: input.yourPrice,
            marketAverage: input.marketAverage,
            sourceFile: fileName
          }
        })
      )
    );

    const marketRateIdsByDate = new Map(
      marketRates.map((marketRate) => [dateKey(marketRate.date), marketRate.id])
    );

    const competitorRateRows = competitorRows.flatMap((competitorRow) => {
      const competitorId = competitorMap.get(competitorRow.label);
      if (!competitorId) {
        return [];
      }

      return marketRateInputs
        .map((input) => {
          const price = competitorRow.valuesByColumn.get(input.columnIndex);
          const marketRateId = marketRateIdsByDate.get(dateKey(input.date));

          if (price === undefined || !marketRateId) {
            return null;
          }

          return {
            competitorId,
            marketRateId,
            price
          };
        })
        .filter(
          (
            row
          ): row is {
            competitorId: number;
            marketRateId: number;
            price: number;
          } => row !== null
        );
    });

    if (competitorRateRows.length > 0) {
      await this.prisma.$transaction([
        this.prisma.competitorMarketRates.deleteMany({
          where: {
            competitorId: {
              in: [...competitorMap.values()]
            },
            marketRateId: {
              in: [...marketRateIdsByDate.values()]
            }
          }
        }),
        this.prisma.competitorMarketRates.createMany({
          data: competitorRateRows,
          skipDuplicates: true
        })
      ]);
    }

    const competitorRatesUpserted = competitorRateRows.length;

    const processedDates = sortedColumns
      .map(([, date]) => date)
      .filter((date) => marketRateIdsByDate.has(dateKey(date)))
      .sort((a, b) => a.getTime() - b.getTime());

    const dateRange =
      processedDates.length > 0
        ? {
            start: processedDates[0].toISOString().slice(0, 10),
            end: processedDates[processedDates.length - 1].toISOString().slice(0, 10)
          }
        : null;

    return {
      hotelRow: hotelRow.label,
      marketAverageRow: marketAverageRow?.label ?? null,
      datesProcessed: marketRateIdsByDate.size,
      dateRange,
      competitorsUpserted: competitorRows.length,
      marketRatesUpserted: marketRateIdsByDate.size,
      competitorRatesUpserted
    };
  }

  async getMarketRates(hotelId: number, startDate: Date, endDate: Date) {
    return this.prisma.marketRates.findMany({
      where: {
        hotelId,
        date: {
          gte: toUtcDateOnly(startDate),
          lte: toUtcDateOnly(endDate)
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
  }

  private parseDateColumns(sheet: ExcelJS.Worksheet): Map<number, Date> {
    const detected = this.detectDateHeaderRows(sheet);
    const monthRow = detected?.monthRow ?? 9;
    const dayOfMonthRow = detected?.dayRow ?? 11;
    const out = new Map<number, Date>();

    let activeMonthLabel = '';

    for (let column = 2; column <= sheet.columnCount; column += 1) {
      const monthLabel = this.cellToString(sheet.getRow(monthRow).getCell(column).value);
      if (monthLabel) {
        activeMonthLabel = monthLabel;
      }

      const day = toNumber(sheet.getRow(dayOfMonthRow).getCell(column).value);
      if (!activeMonthLabel || day === null) {
        continue;
      }

      const parsedDate = this.parseMonthAndDay(activeMonthLabel, day);
      if (parsedDate) {
        out.set(column, parsedDate);
      }
    }

    return out;
  }

  private detectDateHeaderRows(
    sheet: ExcelJS.Worksheet
  ): { monthRow: number; dayRow: number } | null {
    const maxRow = Math.min(sheet.rowCount, 20);
    let best: { monthRow: number; dayRow: number; count: number } | null = null;

    for (let monthRow = 1; monthRow <= maxRow; monthRow += 1) {
      for (let dayRow = monthRow + 1; dayRow <= Math.min(monthRow + 4, maxRow); dayRow += 1) {
        let activeMonthLabel = '';
        let count = 0;

        for (let column = 2; column <= sheet.columnCount; column += 1) {
          const monthLabel = this.cellToString(sheet.getRow(monthRow).getCell(column).value);
          if (monthLabel) {
            activeMonthLabel = monthLabel;
          }

          const day = toNumber(sheet.getRow(dayRow).getCell(column).value);
          if (!activeMonthLabel || day === null || day < 1 || day > 31) {
            continue;
          }

          const parsedDate = this.parseMonthAndDay(activeMonthLabel, day);
          if (parsedDate) {
            count += 1;
          }
        }

        if (!best || count > best.count) {
          best = { monthRow, dayRow, count };
        }
      }
    }

    if (!best || best.count < 3) {
      return null;
    }

    return {
      monthRow: best.monthRow,
      dayRow: best.dayRow
    };
  }

  private parsePriceRows(
    sheet: ExcelJS.Worksheet,
    dateColumns: Map<number, Date>
  ): ParsedPriceRow[] {
    const rows: ParsedPriceRow[] = [];
    const firstDataRow = 12;

    for (let rowIndex = firstDataRow; rowIndex <= sheet.rowCount; rowIndex += 1) {
      const row = sheet.getRow(rowIndex);
      const label = this.cellToString(row.getCell(1).value);
      if (!label) {
        continue;
      }

      const valuesByColumn = new Map<number, number>();

      for (const columnIndex of dateColumns.keys()) {
        const value = this.parsePriceCell(row.getCell(columnIndex).value);
        if (value !== null) {
          valuesByColumn.set(columnIndex, value);
        }
      }

      if (valuesByColumn.size === 0) {
        continue;
      }

      rows.push({
        rowIndex,
        label,
        valuesByColumn
      });
    }

    return rows;
  }

  private pickMarketAverageRow(rows: ParsedPriceRow[]): ParsedPriceRow | null {
    const exact = rows.find((row) =>
      /^competitive\s*set\s*average(?:\s*rates)?$/i.test(row.label.trim())
    );
    if (exact) {
      return exact;
    }

    return rows.find((row) => /competitive\s*set\s*average(?:\s*rates)?/i.test(row.label)) ?? null;
  }

  private parseMonthAndDay(monthLabel: string, day: number): Date | null {
    const normalized = monthLabel.toUpperCase().trim();
    const match = normalized.match(/^([A-Z]+)\s+(\d{4})$/);
    if (!match) {
      return null;
    }

    const month = this.monthMap[match[1]];
    const year = Number(match[2]);
    if (!month || Number.isNaN(year)) {
      return null;
    }

    const date = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date;
  }

  private parsePriceCell(value: ExcelJS.CellValue): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? round2(value) : null;
    }

    if (typeof value === 'string') {
      const normalized = value.trim();
      if (
        !normalized ||
        normalized === '-' ||
        normalized === 'S' ||
        normalized === 'I' ||
        normalized === 'M' ||
        /sold\s*out/i.test(normalized)
      ) {
        return null;
      }

      const firstNumericToken = normalized.match(/-?\d[\d,]*(?:\.\d+)?/);
      const numeric = firstNumericToken ? toNumber(firstNumericToken[0]) : null;
      return numeric === null ? null : round2(numeric);
    }

    if (value instanceof Date) {
      return null;
    }

    if (typeof value === 'object' && 'result' in value) {
      return this.parsePriceCell(value.result as ExcelJS.CellValue);
    }

    if (typeof value === 'object' && 'text' in value) {
      return this.parsePriceCell((value as { text: string }).text);
    }

    if (typeof value === 'object' && 'richText' in value) {
      const text = (value as ExcelJS.CellRichTextValue).richText.map((part) => part.text).join('');
      return this.parsePriceCell(text);
    }

    return null;
  }

  private cellToString(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'string') {
      return value.trim();
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    if (typeof value === 'object' && 'richText' in value) {
      return (value as ExcelJS.CellRichTextValue).richText
        .map((item) => item.text)
        .join('')
        .trim();
    }

    if (typeof value === 'object' && 'text' in value) {
      return String((value as { text: string }).text).trim();
    }

    if (typeof value === 'object' && 'result' in value) {
      return this.cellToString((value as { result: ExcelJS.CellValue }).result);
    }

    return '';
  }
}
