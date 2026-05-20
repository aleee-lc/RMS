import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthHotel, AuthSession, AuthUser, MeResponse } from '../models/auth.model';

const TOKEN_KEY = 'revsight_access_token';
const HOTEL_KEY = 'revsight_selected_hotel_id';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly baseUrl = environment.apiBaseUrl;

  readonly user = signal<AuthUser | null>(null);
  readonly hotels = signal<AuthHotel[]>([]);
  readonly selectedHotelId = signal<number | null>(this.readSelectedHotelId());

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  get isAuthenticated(): boolean {
    return Boolean(this.token);
  }

  login(email: string, password: string) {
    return this.http
      .post<AuthSession>(`${this.baseUrl}/auth/login`, { email, password })
      .pipe(tap((session) => this.setSession(session)));
  }

  loadMe() {
    return this.http.get<MeResponse>(`${this.baseUrl}/auth/me`).pipe(
      tap((response) => {
        this.user.set(response.user);
        this.hotels.set(response.hotels);
        this.ensureSelectedHotel(response.hotels);
      }),
    );
  }

  selectHotel(hotelId: number): void {
    localStorage.setItem(HOTEL_KEY, String(hotelId));
    this.selectedHotelId.set(hotelId);
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(HOTEL_KEY);
    this.user.set(null);
    this.hotels.set([]);
    this.selectedHotelId.set(null);
    void this.router.navigateByUrl('/login');
  }

  private setSession(session: AuthSession): void {
    localStorage.setItem(TOKEN_KEY, session.accessToken);
    this.user.set(session.user);
    this.hotels.set(session.hotels);
    this.ensureSelectedHotel(session.hotels);
  }

  private ensureSelectedHotel(hotels: AuthHotel[]): void {
    const current = this.selectedHotelId();
    if (current && hotels.some((hotel) => hotel.id === current)) {
      return;
    }

    const next = hotels.find((hotel) => hotel.isDefault) ?? hotels[0] ?? null;
    if (next) {
      this.selectHotel(next.id);
    }
  }

  private readSelectedHotelId(): number | null {
    const raw = localStorage.getItem(HOTEL_KEY);
    const parsed = raw ? Number(raw) : null;
    return parsed && Number.isFinite(parsed) ? parsed : null;
  }
}
