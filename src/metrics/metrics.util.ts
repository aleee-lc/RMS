import { round2 } from '../common/utils/number.util';

export function calculateRevpar(revenue: number, totalRooms: number): number {
  if (totalRooms <= 0) {
    return 0;
  }
  return round2(revenue / totalRooms);
}
