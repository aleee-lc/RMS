import ExcelJS from 'exceljs';
import { MarketService } from './market.service';

describe('MarketService', () => {
  const prisma = {
    competitor: {
      upsert: jest.fn()
    },
    marketRates: {
      upsert: jest.fn()
    },
    competitorMarketRates: {
      deleteMany: jest.fn(),
      createMany: jest.fn()
    },
    $transaction: jest.fn()
  } as any;

  let service: MarketService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MarketService(prisma);

    prisma.competitor.upsert.mockImplementation(async ({ create }: any) => ({
      id: create.name === 'Hotel Competitor' ? 201 : 202,
      hotelId: create.hotelId,
      name: create.name
    }));
    prisma.marketRates.upsert.mockImplementation(async ({ create }: any) => ({
      id: create.date.getUTCDate(),
      hotelId: create.hotelId,
      date: create.date,
      yourPrice: create.yourPrice,
      marketAverage: create.marketAverage
    }));
    prisma.competitorMarketRates.deleteMany.mockResolvedValue({ count: 0 });
    prisma.competitorMarketRates.createMany.mockResolvedValue({ count: 2 });
    prisma.$transaction.mockImplementation(async (operations: unknown[]) => operations);
  });

  it('uses the first Expedia price row as the hotel row', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Expedia');
    sheet.getRow(9).getCell(2).value = 'MAY 2026';
    sheet.getRow(11).getCell(2).value = 10;
    sheet.getRow(11).getCell(3).value = 11;
    sheet.getRow(12).getCell(1).value = 'My Property';
    sheet.getRow(12).getCell(2).value = 100;
    sheet.getRow(12).getCell(3).value = 120;
    sheet.getRow(13).getCell(1).value = 'Hotel Competitor';
    sheet.getRow(13).getCell(2).value = 200;
    sheet.getRow(13).getCell(3).value = 220;

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await service.ingestExpediaGrid(1, 'expedia.xlsx', buffer);

    expect(prisma.marketRates.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: expect.objectContaining({
          yourPrice: 100,
          marketAverage: 200
        })
      })
    );
    expect(prisma.marketRates.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        create: expect.objectContaining({
          yourPrice: 120,
          marketAverage: 220
        })
      })
    );
  });
});
