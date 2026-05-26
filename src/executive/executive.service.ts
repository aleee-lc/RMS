import { Injectable } from '@nestjs/common';
import { AlertSeverity, Hotel } from '@prisma/client';
import { BiService, RevenueCalendarItem } from '../bi/bi.service';
import { dateKey, toUtcDateOnly } from '../common/utils/date.util';
import { clamp, round2 } from '../common/utils/number.util';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';

type HealthStatus = 'healthy' | 'attention' | 'risk';

interface ExecutiveRange {
  startDate: Date;
  endDate: Date;
}

interface ExportFile {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

interface Driver {
  label: string;
  impact: 'positive' | 'negative' | 'neutral';
}

type ExecutiveHotel = Pick<Hotel, 'id' | 'name' | 'totalRooms'> & {
  currency?: string;
  timezone?: string;
};

@Injectable()
export class ExecutiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly biService: BiService,
    private readonly reportsService: ReportsService
  ) {}

  async getOverview(hotel: ExecutiveHotel, startDate: Date, endDate: Date) {
    const range = this.normalizeRange(startDate, endDate);
    const [summary, rows, compliance, activeAlerts] = await Promise.all([
      this.biService.getExecutiveSummary(hotel, range.startDate, range.endDate),
      this.biService.getRevenueCalendar(hotel, range.startDate, range.endDate),
      this.reportsService.getRecommendationComplianceReport(hotel.id, range, 2),
      this.prisma.alerts.findMany({
        where: {
          hotelId: hotel.id,
          resolved: false,
          date: {
            gte: range.startDate,
            lte: range.endDate
          }
        },
        orderBy: [{ severity: 'desc' }, { date: 'asc' }]
      })
    ]);

    const avgCompSetGap = this.averageNullable(
      rows.map((row) => (row.market?.gapPct === null || row.market?.gapPct === undefined ? null : row.market.gapPct))
    );
    const health = this.buildHealth(summary, rows, compliance, activeAlerts);
    const opportunity = this.extractOpportunity(summary.top_opportunities);
    const risk = this.extractRisk(summary.top_risks);
    const avgPickup7d = rows.length > 0 ? round2(this.average(rows.map((row) => row.pickup.rooms7d))) : 0;
    const forecastRevenue = round2(rows.reduce((sum, row) => sum + (row.revenue ?? 0), 0));
    const revpar =
      hotel.totalRooms > 0 && rows.length > 0
        ? round2((forecastRevenue / rows.length) / hotel.totalRooms)
        : 0;
    const previousPeriod = await this.loadPreviousPeriodOverview(hotel, range);

    return {
      hotel: this.hotelSummary(hotel),
      range: this.rangeSummary(range),
      kpis: {
        occupancy: round2(summary.kpis.avg_occupancy),
        adr: round2(summary.kpis.avg_adr),
        revpar,
        revenue: round2(summary.kpis.total_revenue),
        pickup7d: avgPickup7d,
        forecastRevenue,
        activeAlerts: summary.kpis.active_alerts
      },
      comparisons: {
        vsPreviousPeriodRevenuePct: this.percentDelta(
          previousPeriod.revenue,
          summary.kpis.total_revenue
        ),
        vsPreviousPeriodAdrPct: this.percentDelta(previousPeriod.adr, summary.kpis.avg_adr),
        vsPreviousPeriodOccupancyPts: round2(summary.kpis.avg_occupancy - previousPeriod.occupancy),
        vsCompSetPricePct: avgCompSetGap
      },
      health,
      topRisks: summary.top_risks.slice(0, 5).map((row) => this.mapRiskItem(row)),
      topOpportunities: summary.top_opportunities.slice(0, 5).map((row) => this.mapOpportunityItem(row)),
      highlights: {
        bestOpportunityDate: opportunity,
        biggestRiskDate: risk,
        recommendationCompliancePct: compliance.summary.total - compliance.summary.unknown > 0
          ? round2(
              (compliance.summary.compliant /
                (compliance.summary.total - compliance.summary.unknown)) *
                100
            )
          : null
      }
    };
  }

  async getFinancialHealth(hotel: ExecutiveHotel, startDate: Date, endDate: Date) {
    const range = this.normalizeRange(startDate, endDate);
    const overview = await this.getOverview(hotel, range.startDate, range.endDate);

    return {
      hotel: overview.hotel,
      range: overview.range,
      health: overview.health,
      kpis: overview.kpis,
      comparisons: overview.comparisons
    };
  }

  async getTopRisks(hotel: ExecutiveHotel, startDate: Date, endDate: Date) {
    const range = this.normalizeRange(startDate, endDate);
    const overview = await this.getOverview(hotel, range.startDate, range.endDate);
    return {
      hotel: overview.hotel,
      range: overview.range,
      count: overview.topRisks.length,
      items: overview.topRisks
    };
  }

  async getTopOpportunities(hotel: ExecutiveHotel, startDate: Date, endDate: Date) {
    const range = this.normalizeRange(startDate, endDate);
    const overview = await this.getOverview(hotel, range.startDate, range.endDate);
    return {
      hotel: overview.hotel,
      range: overview.range,
      count: overview.topOpportunities.length,
      items: overview.topOpportunities
    };
  }

  async getOwnerSummary(hotel: ExecutiveHotel, startDate: Date, endDate: Date) {
    const overview = await this.getOverview(hotel, startDate, endDate);
    return {
      ...overview,
      narrative: this.buildNarrative(overview)
    };
  }

  async exportOverviewCsv(hotel: ExecutiveHotel, startDate: Date, endDate: Date): Promise<ExportFile> {
    const overview = await this.getOverview(hotel, startDate, endDate);
    const lines = [
      ['KPI', 'Valor'].join(','),
      ['Occupancy %', overview.kpis.occupancy],
      ['ADR', overview.kpis.adr],
      ['RevPAR', overview.kpis.revpar],
      ['Revenue', overview.kpis.revenue],
      ['Pickup 7d', overview.kpis.pickup7d],
      ['Forecast Revenue', overview.kpis.forecastRevenue],
      ['Financial Health Score', overview.health.score],
      ['Health Status', overview.health.status]
    ].map((row) => (Array.isArray(row) ? row.map((value) => this.csvCell(value)).join(',') : row));

    return {
      filename: `executive-overview-${overview.range.start}_a_${overview.range.end}.csv`,
      contentType: 'text/csv; charset=utf-8',
      buffer: Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8')
    };
  }

  async exportOnePagePdf(hotel: ExecutiveHotel, startDate: Date, endDate: Date): Promise<ExportFile> {
    const overview = await this.getOverview(hotel, startDate, endDate);
    const lines = [
      'Executive One-Page',
      `${overview.hotel.name} | ${overview.range.start} a ${overview.range.end}`,
      '',
      `Financial Health Score: ${overview.health.score} (${overview.health.status})`,
      `Occupancy ${overview.kpis.occupancy}% | ADR ${overview.kpis.adr} | RevPAR ${overview.kpis.revpar}`,
      `Revenue ${overview.kpis.revenue} | Pickup7d ${overview.kpis.pickup7d} | Forecast ${overview.kpis.forecastRevenue}`,
      '',
      'Top riesgos',
      ...overview.topRisks.map(
        (item) => `${item.date} | Risk ${item.riskScore} | ${item.title} | ${item.reason}`
      ),
      '',
      'Top oportunidades',
      ...overview.topOpportunities.map(
        (item) =>
          `${item.date} | Opp ${item.opportunityScore} | ${item.title} | Impacto ${item.estimatedImpact}`
      ),
      '',
      'Drivers',
      ...overview.health.drivers.map((driver) => `${driver.impact.toUpperCase()}: ${driver.label}`)
    ];

    return this.pdfFile('executive-one-page', overview.range, this.buildPdfBuffer(lines));
  }

  async exportWeeklyBriefPdf(
    hotel: ExecutiveHotel,
    startDate: Date,
    endDate: Date
  ): Promise<ExportFile> {
    const [overview, topRisks, topOpportunities] = await Promise.all([
      this.getOverview(hotel, startDate, endDate),
      this.getTopRisks(hotel, startDate, endDate),
      this.getTopOpportunities(hotel, startDate, endDate)
    ]);

    const lines = [
      'Weekly Revenue Brief',
      `${overview.hotel.name} | ${overview.range.start} a ${overview.range.end}`,
      '',
      `Health ${overview.health.score} (${overview.health.status}) | Revenue ${overview.kpis.revenue} | RevPAR ${overview.kpis.revpar}`,
      `Vs periodo previo revenue ${this.displayPct(overview.comparisons.vsPreviousPeriodRevenuePct)} | ADR ${this.displayPct(overview.comparisons.vsPreviousPeriodAdrPct)}`,
      '',
      'Riesgos prioritarios',
      ...topRisks.items.map(
        (item) => `${item.date} | ${item.title} | ${item.reason} | Revenue at risk ${item.revenueAtRisk}`
      ),
      '',
      'Oportunidades prioritarias',
      ...topOpportunities.items.map(
        (item) =>
          `${item.date} | ${item.title} | ${item.reason} | Revenue upside ${item.estimatedImpact}`
      ),
      '',
      'Comentario ejecutivo',
      this.buildNarrative(overview)
    ];

    return this.pdfFile('weekly-revenue-brief', overview.range, this.buildPdfBuffer(lines));
  }

  async exportBoardReportPdf(
    hotel: ExecutiveHotel,
    startDate: Date,
    endDate: Date
  ): Promise<ExportFile> {
    const overview = await this.getOwnerSummary(hotel, startDate, endDate);
    const lines = [
      'Board Report',
      `${overview.hotel.name} | ${overview.range.start} a ${overview.range.end}`,
      '',
      'KPIs',
      `Occupancy ${overview.kpis.occupancy}% | ADR ${overview.kpis.adr} | RevPAR ${overview.kpis.revpar}`,
      `Revenue ${overview.kpis.revenue} | Forecast ${overview.kpis.forecastRevenue} | Alertas ${overview.kpis.activeAlerts}`,
      '',
      'Comparativos',
      `Revenue vs previo ${this.displayPct(overview.comparisons.vsPreviousPeriodRevenuePct)}`,
      `ADR vs previo ${this.displayPct(overview.comparisons.vsPreviousPeriodAdrPct)}`,
      `Occupancy vs previo ${overview.comparisons.vsPreviousPeriodOccupancyPts} pts`,
      `Brecha comp set ${this.displayPct(overview.comparisons.vsCompSetPricePct)}`,
      '',
      'Salud financiera',
      `Score ${overview.health.score} | Estado ${overview.health.status}`,
      ...overview.health.drivers.map((driver) => `${driver.impact.toUpperCase()}: ${driver.label}`),
      '',
      'Narrativa',
      overview.narrative
    ];

    return this.pdfFile('board-report', overview.range, this.buildPdfBuffer(lines));
  }

  private normalizeRange(startDate: Date, endDate: Date): ExecutiveRange {
    return {
      startDate: toUtcDateOnly(startDate),
      endDate: toUtcDateOnly(endDate)
    };
  }

  private async loadPreviousPeriodOverview(hotel: ExecutiveHotel, range: ExecutiveRange) {
    const spanDays =
      Math.max(
        1,
        Math.round((range.endDate.getTime() - range.startDate.getTime()) / 86400000) + 1
      ) || 1;
    const previousEnd = new Date(range.startDate);
    previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setUTCDate(previousStart.getUTCDate() - (spanDays - 1));

    const summary = await this.biService.getExecutiveSummary(hotel, previousStart, previousEnd);
    return {
      occupancy: round2(summary.kpis.avg_occupancy),
      adr: round2(summary.kpis.avg_adr),
      revenue: round2(summary.kpis.total_revenue)
    };
  }

  private buildHealth(
    summary: Awaited<ReturnType<BiService['getExecutiveSummary']>>,
    rows: RevenueCalendarItem[],
    compliance: Awaited<ReturnType<ReportsService['getRecommendationComplianceReport']>>,
    activeAlerts: Array<{ severity: AlertSeverity; title: string }>
  ) {
    const occupancy = round2(summary.kpis.avg_occupancy);
    const avgGap = this.averageNullable(
      rows.map((row) => (row.market?.gapPct === null || row.market?.gapPct === undefined ? null : row.market.gapPct))
    ) ?? 0;
    const avgPickup = rows.length > 0 ? this.average(rows.map((row) => row.pickup.rooms7d)) : 0;
    const acceleratedRatio =
      rows.length > 0
        ? rows.filter((row) => row.pickup.accelerated).length / rows.length
        : 0;
    const measurableCompliance = compliance.summary.total - compliance.summary.unknown;
    const complianceRatio =
      measurableCompliance > 0 ? compliance.summary.compliant / measurableCompliance : 0.5;
    const highAlerts = activeAlerts.filter((alert) => alert.severity === AlertSeverity.HIGH).length;

    const demandScore = clamp((occupancy / 75) * 25, 0, 25);
    const marketScore = clamp(20 - Math.abs(avgGap) * 1.5, 0, 20);
    const pickupScore = clamp((avgPickup / 8) * 15 + acceleratedRatio * 5, 0, 20);
    const complianceScore = clamp(complianceRatio * 15, 0, 15);
    const alertScore = clamp(20 - activeAlerts.length * 2 - highAlerts * 2, 0, 20);

    const score = Math.round(demandScore + marketScore + pickupScore + complianceScore + alertScore);
    const status: HealthStatus = score >= 80 ? 'healthy' : score >= 60 ? 'attention' : 'risk';

    const drivers: Driver[] = [];
    if (occupancy >= 70) {
      drivers.push({ label: `Ocupacion promedio saludable de ${occupancy}%`, impact: 'positive' });
    } else if (occupancy <= 35) {
      drivers.push({ label: `Ocupacion promedio baja de ${occupancy}%`, impact: 'negative' });
    } else {
      drivers.push({ label: `Ocupacion promedio intermedia de ${occupancy}%`, impact: 'neutral' });
    }

    if (avgGap <= -5) {
      drivers.push({
        label: `Precio ${Math.abs(round2(avgGap))}% por debajo del comp set`,
        impact: 'negative'
      });
    } else if (avgGap >= 5) {
      drivers.push({
        label: `Precio ${round2(avgGap)}% por encima del comp set`,
        impact: 'neutral'
      });
    } else {
      drivers.push({ label: 'Posicion tarifaria alineada al comp set', impact: 'positive' });
    }

    if (activeAlerts.length > 0) {
      drivers.push({
        label: `${activeAlerts.length} alertas activas dentro del rango`,
        impact: highAlerts > 0 ? 'negative' : 'neutral'
      });
    } else {
      drivers.push({ label: 'Sin alertas activas en el rango', impact: 'positive' });
    }

    if (measurableCompliance > 0) {
      drivers.push({
        label: `Cumplimiento de recomendaciones de ${round2(complianceRatio * 100)}%`,
        impact: complianceRatio >= 0.7 ? 'positive' : 'negative'
      });
    }

    return {
      score,
      status,
      drivers
    };
  }

  private extractOpportunity(rows: RevenueCalendarItem[]) {
    const row = [...rows].sort((a, b) => b.opportunityScore - a.opportunityScore)[0];
    if (!row) {
      return null;
    }

    return {
      date: row.date,
      opportunityScore: row.opportunityScore,
      estimatedImpact: row.recommendation.estimatedImpact
    };
  }

  private extractRisk(rows: RevenueCalendarItem[]) {
    const row = [...rows].sort((a, b) => b.riskScore - a.riskScore)[0];
    if (!row) {
      return null;
    }

    return {
      date: row.date,
      riskScore: row.riskScore
    };
  }

  private mapRiskItem(row: RevenueCalendarItem) {
    return {
      date: row.date,
      title: row.recommendation.label,
      reason: row.recommendation.reason,
      riskScore: row.riskScore,
      occupancy: row.occupancy,
      pickup7d: row.pickup.rooms7d,
      revenueAtRisk: round2(Math.max(0, (row.revenue ?? 0) * (row.riskScore / 100))),
      signals: row.signals.map((signal) => signal.title)
    };
  }

  private mapOpportunityItem(row: RevenueCalendarItem) {
    return {
      date: row.date,
      title: row.recommendation.label,
      reason: row.recommendation.reason,
      opportunityScore: row.opportunityScore,
      occupancy: row.occupancy,
      pickup7d: row.pickup.rooms7d,
      estimatedImpact: row.recommendation.estimatedImpact,
      signals: row.signals.map((signal) => signal.title)
    };
  }

  private buildNarrative(overview: Awaited<ReturnType<ExecutiveService['getOverview']>>) {
    const revenueTrend = this.displayPct(overview.comparisons.vsPreviousPeriodRevenuePct);
    const adrTrend = this.displayPct(overview.comparisons.vsPreviousPeriodAdrPct);
    const compGap = this.displayPct(overview.comparisons.vsCompSetPricePct);
    const topOpportunity = overview.topOpportunities[0];
    const topRisk = overview.topRisks[0];

    return `La salud financiera del hotel se ubica en ${overview.health.status} con score ${overview.health.score}. El revenue del periodo se mueve ${revenueTrend} frente al periodo previo y el ADR cambia ${adrTrend}. La posicion tarifaria frente al comp set se ubica en ${compGap}. La mejor oportunidad identificada es ${topOpportunity ? `${topOpportunity.date} con impacto estimado de ${topOpportunity.estimatedImpact}` : 'sin oportunidad material'} y el principal riesgo es ${topRisk ? `${topRisk.date} con revenue en riesgo de ${topRisk.revenueAtRisk}` : 'sin riesgo material'}.`;
  }

  private rangeSummary(range: ExecutiveRange) {
    return {
      start: dateKey(range.startDate),
      end: dateKey(range.endDate)
    };
  }

  private hotelSummary(hotel: ExecutiveHotel) {
    return {
      id: hotel.id,
      name: hotel.name,
      totalRooms: hotel.totalRooms,
      currency: hotel.currency ?? 'MXN'
    };
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private averageNullable(values: Array<number | null>): number | null {
    const filtered = values.filter((value): value is number => value !== null);
    if (filtered.length === 0) {
      return null;
    }

    return round2(this.average(filtered));
  }

  private percentDelta(previous: number, current: number): number | null {
    if (!previous) {
      return current ? 100 : 0;
    }

    return round2(((current - previous) / previous) * 100);
  }

  private displayPct(value: number | null) {
    return value === null ? 'N/D' : `${value}%`;
  }

  private csvCell(value: unknown): string {
    const text = value === null || value === undefined ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  private pdfFile(prefix: string, range: { start: string; end: string }, buffer: Buffer): ExportFile {
    return {
      filename: `${prefix}-${range.start}_a_${range.end}.pdf`,
      contentType: 'application/pdf',
      buffer
    };
  }

  private buildPdfBuffer(lines: string[]): Buffer {
    const width = 842;
    const height = 595;
    const margin = 32;
    const lineHeight = 13;
    const pages: string[] = [];
    let currentLines: Array<{ text: string; x: number; y: number; size: number; bold?: boolean }> = [];
    let y = height - margin;

    const pushPage = () => {
      pages.push(this.renderPdfPage(currentLines));
      currentLines = [];
      y = height - margin;
    };

    for (const [index, line] of lines.entries()) {
      if (y < margin + 18) {
        pushPage();
      }

      currentLines.push({
        text: line,
        x: margin,
        y,
        size: index === 0 ? 18 : line.endsWith(':') || /^[A-Z][A-Za-z ]+$/.test(line) ? 11 : 9,
        bold: index === 0 || line === 'Top riesgos' || line === 'Top oportunidades' || line === 'Drivers' || line === 'Riesgos prioritarios' || line === 'Oportunidades prioritarias' || line === 'Comentario ejecutivo' || line === 'KPIs' || line === 'Comparativos' || line === 'Salud financiera' || line === 'Narrativa'
      });
      y -= lineHeight;
    }

    pages.push(this.renderPdfPage(currentLines));
    return this.assemblePdf(pages, width, height);
  }

  private renderPdfPage(
    lines: Array<{ text: string; x: number; y: number; size: number; bold?: boolean }>
  ): string {
    return lines
      .map((line) => {
        const font = line.bold ? 'F2' : 'F1';
        return `BT /${font} ${line.size} Tf ${line.x} ${line.y} Td (${this.escapePdfText(line.text)}) Tj ET`;
      })
      .join('\n');
  }

  private escapePdfText(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  private assemblePdf(pageContents: string[], width: number, height: number): Buffer {
    const objects: string[] = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      `<< /Type /Pages /Kids [${pageContents
        .map((_, index) => `${3 + index * 2} 0 R`)
        .join(' ')}] /Count ${pageContents.length} >>`
    ];

    pageContents.forEach((content, index) => {
      const pageObjectId = 3 + index * 2;
      const contentObjectId = pageObjectId + 1;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >> /Contents ${contentObjectId} 0 R >>`
      );
      objects.push(
        `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`
      );
    });

    let body = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(body, 'ascii'));
      body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(body, 'ascii');
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    body += offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join('');
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(body, 'ascii');
  }
}
