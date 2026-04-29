import { RateShoppingNormalizer } from './rate-shopping.normalizer';

describe('RateShoppingNormalizer', () => {
  let normalizer: RateShoppingNormalizer;

  beforeEach(() => {
    normalizer = new RateShoppingNormalizer();
  });

  it('normalizes total stay prices to nightly values', () => {
    const results = normalizer.normalize(
      'Competitor A',
      {
        targetHotelName: 'Competitor A',
        city: 'Los Mochis',
        checkInDate: new Date('2026-06-10T00:00:00.000Z'),
        checkOutDate: new Date('2026-06-12T00:00:00.000Z'),
        adults: 2
      },
      [
        {
          hotelName: 'Competitor A',
          source: 'Expedia',
          price: 400,
          currency: 'MXN',
          availability: true,
          occupancyAdults: 2,
          priceMode: 'total_stay',
          rawText: 'MXN 400 total for 2 nights',
          scrapedAt: new Date('2026-04-24T00:00:00.000Z')
        }
      ]
    );

    expect(results).toHaveLength(1);
    expect(results[0].pricePerNight).toBe(200);
  });

  it('filters incomplete or mismatched occupancy rows', () => {
    const results = normalizer.normalize(
      'Competitor B',
      {
        targetHotelName: 'Competitor B',
        city: 'Los Mochis',
        checkInDate: new Date('2026-06-10T00:00:00.000Z'),
        checkOutDate: new Date('2026-06-11T00:00:00.000Z'),
        adults: 2
      },
      [
        {
          hotelName: 'Competitor B',
          source: 'Booking',
          price: null,
          currency: 'MXN',
          availability: true,
          occupancyAdults: 2,
          priceMode: 'per_night',
          rawText: 'no price',
          scrapedAt: new Date()
        },
        {
          hotelName: 'Competitor B',
          source: 'Booking',
          price: 250,
          currency: 'MXN',
          availability: false,
          occupancyAdults: 2,
          priceMode: 'per_night',
          rawText: 'sold out',
          scrapedAt: new Date()
        },
        {
          hotelName: 'Competitor B',
          source: 'Booking',
          price: 260,
          currency: 'MXN',
          availability: true,
          occupancyAdults: 1,
          priceMode: 'per_night',
          rawText: '1 adult',
          scrapedAt: new Date()
        }
      ]
    );

    expect(results).toHaveLength(0);
  });
});
