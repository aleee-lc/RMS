import { HotelRole, UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthenticatedRequest {
  user?: AuthenticatedUser;
}

export interface UserHotelAccess {
  hotelId: number;
  role: HotelRole;
}
