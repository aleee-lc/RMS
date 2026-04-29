import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ReportsService } from '../../core/services/reports.service';
import { ReportsPageComponent } from './reports-page.component';

describe('ReportsPageComponent', () => {
  const mockGenericReport = {
    hotel: { id: 1, name: 'Hotel', totalRooms: 100 },
    report: 'sample',
    items: []
  };

  const mockPickupReport = {
    hotel: { id: 1, name: 'Hotel', totalRooms: 100 },
    report: 'pickup',
    summary: {
      active_reservations_considered: 5,
      rooms_booked: 8,
      revenue_booked: 12000
    },
    daily_booking_pickup: [
      {
        booking_date: '2026-04-20',
        reservations_count: 3,
        rooms_booked: 4,
        revenue_booked: 6400,
        future_rooms_booked: 4,
        future_revenue_booked: 6400
      }
    ],
    stay_date_pickup: []
  };

  const reportsServiceMock = {
    getPickupReport: vi.fn(() => of(mockPickupReport)),
    getForecastVarianceReport: vi.fn(() => of(mockGenericReport)),
    getMarketPositionReport: vi.fn(() => of(mockGenericReport)),
    getRecommendationComplianceReport: vi.fn(() => of(mockGenericReport)),
    getRevenueOpportunityReport: vi.fn(() => of(mockGenericReport)),
    getExecutiveSummaryReport: vi.fn(() => of(mockGenericReport)),
    getCrsReconciliationReport: vi.fn(() => of(mockGenericReport))
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [ReportsPageComponent],
      providers: [provideNoopAnimations(), { provide: ReportsService, useValue: reportsServiceMock }]
    }).compileComponents();
  });

  it('should create and load all reports', () => {
    const fixture = TestBed.createComponent(ReportsPageComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect(reportsServiceMock.getPickupReport).toHaveBeenCalled();
    expect(reportsServiceMock.getForecastVarianceReport).toHaveBeenCalled();
    expect(reportsServiceMock.getMarketPositionReport).toHaveBeenCalled();
    expect(reportsServiceMock.getRecommendationComplianceReport).toHaveBeenCalled();
    expect(reportsServiceMock.getRevenueOpportunityReport).toHaveBeenCalled();
    expect(reportsServiceMock.getExecutiveSummaryReport).toHaveBeenCalled();
    expect(reportsServiceMock.getCrsReconciliationReport).toHaveBeenCalled();
  });

  it('switches report context and builds the selected table view', () => {
    const fixture = TestBed.createComponent(ReportsPageComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.onSelectReport('pickup');

    expect(component.selectedReport()).toBe('pickup');
    expect(component.selectedReportView().primaryTable?.id).toBe('pickup-booking');
    expect(component.selectedReportView().primaryTable?.rows.length).toBe(1);
  });
});
