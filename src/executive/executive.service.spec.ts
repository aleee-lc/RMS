import { ExecutiveService } from './executive.service';

describe('ExecutiveService', () => {
  const prisma = {
    alerts: {
      findMany: jest.fn()
    }
  } as any;

  const biService = {
    getExecutiveSummary: jest.fn(),
    getRevenueCalendar: jest.fn()
  } as any;

  const reportsService = {
    getRecommendationComplianceReport: jest.fn()
  } as any;

  let service: ExecutiveService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExecutiveService(prisma, biService, reportsService);
  });

  it('builds overview and financial health for executives', async () => {
    biService.getExecutiveSummary
      .mockResolvedValueOnce({
        kpis: {
          avg_occupancy: 72,
          avg_adr: 1800,
          total_revenue: 500000,
          active_alerts: 1,
          market_position: { avg_price_gap_pct: -4 },
          revenue_opportunity: {}
        },
        top_opportunities: [
          {
            date: '2026-06-10',
            opportunityScore: 88,
            recommendation: {
              label: 'Subir tarifa ligeramente',
              reason: 'Demanda fuerte.',
              estimatedImpact: 12000
            },
            occupancy: 80,
            pickup: { rooms7d: 12 },
            signals: [{ title: 'Demanda acelerada' }]
          }
        ],
        top_risks: [
          {
            date: '2026-06-12',
            riskScore: 70,
            recommendation: {
              label: 'Revisar promocion',
              reason: 'Baja demanda.',
              estimatedImpact: 0
            },
            occupancy: 25,
            pickup: { rooms7d: 1 },
            revenue: 20000,
            signals: [{ title: 'Sin pickup reciente' }]
          }
        ]
      })
      .mockResolvedValueOnce({
        kpis: {
          avg_occupancy: 65,
          avg_adr: 1700,
          total_revenue: 450000
        }
      });

    biService.getRevenueCalendar.mockResolvedValue([
      {
        date: '2026-06-10',
        occupancy: 80,
        revenue: 20000,
        pickup: { rooms7d: 12, accelerated: true },
        opportunityScore: 88,
        riskScore: 15,
        recommendation: {
          label: 'Subir tarifa ligeramente',
          reason: 'Demanda fuerte.',
          estimatedImpact: 12000
        },
        signals: [{ title: 'Demanda acelerada' }]
      },
      {
        date: '2026-06-12',
        occupancy: 25,
        revenue: 15000,
        pickup: { rooms7d: 1, accelerated: false },
        opportunityScore: 20,
        riskScore: 70,
        recommendation: {
          label: 'Revisar promocion',
          reason: 'Baja demanda.',
          estimatedImpact: 0
        },
        signals: [{ title: 'Sin pickup reciente' }]
      }
    ]);

    reportsService.getRecommendationComplianceReport.mockResolvedValue({
      summary: {
        total: 4,
        compliant: 3,
        unknown: 1
      }
    });

    prisma.alerts.findMany.mockResolvedValue([{ severity: 'HIGH', title: 'Low occupancy detected' }]);

    const overview = await service.getOverview(
      { id: 1, name: 'Demo Hotel', totalRooms: 100, currency: 'MXN' },
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-06-30T00:00:00.000Z')
    );

    expect(overview.health.score).toBeGreaterThan(0);
    expect(overview.kpis.revpar).toBeGreaterThan(0);
    expect(overview.topOpportunities).toHaveLength(1);
    expect(overview.topRisks).toHaveLength(1);
    expect(overview.highlights.recommendationCompliancePct).toBe(100);
  });
});
