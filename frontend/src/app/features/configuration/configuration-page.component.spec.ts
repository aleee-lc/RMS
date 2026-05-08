import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { CompetitorsService } from '../../core/services/competitors.service';
import { HotelsService } from '../../core/services/hotels.service';
import { ConfigurationPageComponent } from './configuration-page.component';

describe('ConfigurationPageComponent', () => {
  const hotelsServiceMock = {
    getHotels: vi.fn(() =>
      of({
        count: 1,
        items: [
          {
            id: 1,
            code: 'WGLM',
            name: 'Hotel Test',
            totalRooms: 100,
            currency: 'MXN',
            timezone: 'America/Chihuahua'
          }
        ]
      })
    ),
    getHotel: vi.fn(() =>
      of({
        item: {
          id: 1,
          code: 'WGLM',
          name: 'Hotel Test',
          totalRooms: 100,
          currency: 'MXN',
          timezone: 'America/Chihuahua'
        }
      })
    ),
    createHotel: vi.fn(() =>
      of({
        item: {
          id: 2,
          code: 'NEW1',
          name: 'Nuevo Hotel',
          totalRooms: 80,
          currency: 'MXN',
          timezone: 'America/Chihuahua'
        }
      })
    ),
    updateHotel: vi.fn(() =>
      of({
        item: {
          id: 1,
          code: 'WGLM',
          name: 'Hotel Test Updated',
          totalRooms: 110,
          currency: 'MXN',
          timezone: 'America/Chihuahua'
        }
      })
    ),
    getRecommendationSettings: vi.fn(() =>
      of({
        isDefault: true,
        item: {
          highOccupancyThreshold: 70,
          lowOccupancyThreshold: 30,
          significantDiffPct: 5,
          demandWeight: 0.5,
          marketWeight: 0.6,
          maxAdjustmentPct: 5,
          minActionStepPct: 5
        }
      })
    ),
    updateRecommendationSettings: vi.fn(() =>
      of({
        item: {
          highOccupancyThreshold: 72,
          lowOccupancyThreshold: 28,
          significantDiffPct: 5,
          demandWeight: 0.5,
          marketWeight: 0.6,
          maxAdjustmentPct: 5,
          minActionStepPct: 5
        }
      })
    )
  };

  const competitorsServiceMock = {
    getCompetitorsByHotel: vi.fn(() => of({ count: 0, items: [] })),
    createCompetitor: vi.fn(() => of({ item: { id: 10, hotelId: 1, name: 'Comp A' } })),
    updateCompetitor: vi.fn(() => of({ item: { id: 10, hotelId: 1, name: 'Comp B' } })),
    deleteCompetitor: vi.fn(() => of({ deleted: true, id: 10 }))
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [ConfigurationPageComponent],
      providers: [
        provideNoopAnimations(),
        { provide: HotelsService, useValue: hotelsServiceMock },
        { provide: CompetitorsService, useValue: competitorsServiceMock }
      ]
    }).compileComponents();
  });

  it('should create and load hotels', () => {
    const fixture = TestBed.createComponent(ConfigurationPageComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component).toBeTruthy();
    expect(hotelsServiceMock.getHotels).toHaveBeenCalled();
  });

  it('creates a hotel when form is valid', () => {
    const fixture = TestBed.createComponent(ConfigurationPageComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.createHotelForm.setValue({
      code: 'NEW1',
      name: 'Nuevo Hotel',
      totalRooms: 80,
      currency: 'MXN',
      timezone: 'America/Chihuahua'
    });

    component.onCreateHotel();

    expect(hotelsServiceMock.createHotel).toHaveBeenCalled();
  });

  it('does not create hotel when form is invalid', () => {
    const fixture = TestBed.createComponent(ConfigurationPageComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.createHotelForm.setValue({
      code: '',
      name: '',
      totalRooms: 0,
      currency: 'MXN',
      timezone: 'America/Chihuahua'
    });

    component.onCreateHotel();

    expect(hotelsServiceMock.createHotel).not.toHaveBeenCalled();
  });

  it('enables competitor save only when draft changed and valid', () => {
    const fixture = TestBed.createComponent(ConfigurationPageComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const competitor = { id: 10, hotelId: 1, name: 'Comp A' };

    component.competitorDrafts.set({ 10: 'Comp A' });
    expect(component.canSaveCompetitor(competitor)).toBe(false);

    component.competitorDrafts.set({ 10: 'Comp A Prime' });
    expect(component.canSaveCompetitor(competitor)).toBe(true);
  });
});
