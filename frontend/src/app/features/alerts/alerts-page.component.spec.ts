import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AlertsService } from '../../core/services/alerts.service';
import { AlertsPageComponent } from './alerts-page.component';

describe('AlertsPageComponent', () => {
  const alertsServiceMock = {
    getAlerts: vi.fn(() =>
      of({
        hotel: { id: 1, name: 'Hotel', totalRooms: 100 },
        count: 1,
        items: [
          {
            id: 21,
            date: '2026-04-24',
            type: 'competitive-set',
            severity: 'high',
            title: 'High demand',
            message: 'Increase rate',
            resolved: false,
          },
        ],
      }),
    ),
    resolveAlert: vi.fn(() =>
      of({
        hotel: { id: 1, name: 'Hotel', totalRooms: 100 },
        item: {
          id: 21,
          date: '2026-04-24',
          type: 'competitive-set',
          severity: 'high',
          title: 'High demand',
          message: 'Increase rate',
          resolved: true,
        },
      }),
    ),
    activateAlert: vi.fn(() =>
      of({
        hotel: { id: 1, name: 'Hotel', totalRooms: 100 },
        item: {
          id: 21,
          date: '2026-04-24',
          type: 'competitive-set',
          severity: 'high',
          title: 'High demand',
          message: 'Increase rate',
          resolved: false,
        },
      }),
    ),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [AlertsPageComponent],
      providers: [provideNoopAnimations(), { provide: AlertsService, useValue: alertsServiceMock }],
    }).compileComponents();
  });

  it('should create and load alerts', () => {
    const fixture = TestBed.createComponent(AlertsPageComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect(alertsServiceMock.getAlerts).toHaveBeenCalled();
  });

  it('resolves an active alert', () => {
    const fixture = TestBed.createComponent(AlertsPageComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const alert = component.items()[0];

    component.onToggleResolved(alert);

    expect(alertsServiceMock.resolveAlert).toHaveBeenCalledWith(21);
  });

  it('applies resolved filter and requests only active alerts', () => {
    const fixture = TestBed.createComponent(AlertsPageComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.onResolvedFilterChange('false');

    expect(alertsServiceMock.getAlerts).toHaveBeenLastCalledWith(
      expect.objectContaining({ resolved: false }),
    );
  });
});
