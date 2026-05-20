export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: 'ADMIN' | 'USER';
}

export interface AuthHotel {
  id: number;
  code: string;
  name: string;
  totalRooms: number;
  currency: string;
  timezone: string;
  role: 'OWNER' | 'MANAGER' | 'ANALYST' | 'VIEWER';
  isDefault: boolean;
}

export interface AuthSession {
  accessToken: string;
  user: AuthUser;
  hotels: AuthHotel[];
}

export interface MeResponse {
  user: AuthUser;
  hotels: AuthHotel[];
}
