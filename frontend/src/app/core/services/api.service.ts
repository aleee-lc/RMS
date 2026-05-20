import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

export type QueryParamValue = string | number | boolean | null | undefined;

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly baseUrl = environment.apiBaseUrl;

  get<T>(path: string, queryParams?: Record<string, QueryParamValue>): Observable<T> {
    return this.http.get<T>(`${this.baseUrl}${path}`, {
      params: this.toHttpParams(queryParams),
    });
  }

  getBlob(
    path: string,
    queryParams?: Record<string, QueryParamValue>,
  ): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.baseUrl}${path}`, {
      observe: 'response',
      params: this.toHttpParams(queryParams),
      responseType: 'blob',
    });
  }

  post<T>(
    path: string,
    body: unknown,
    queryParams?: Record<string, QueryParamValue>,
  ): Observable<T> {
    return this.http.post<T>(`${this.baseUrl}${path}`, body, {
      params: this.toHttpParams(queryParams),
    });
  }

  patch<T>(
    path: string,
    body: unknown,
    queryParams?: Record<string, QueryParamValue>,
  ): Observable<T> {
    return this.http.patch<T>(`${this.baseUrl}${path}`, body, {
      params: this.toHttpParams(queryParams),
    });
  }

  delete<T>(path: string, queryParams?: Record<string, QueryParamValue>): Observable<T> {
    return this.http.delete<T>(`${this.baseUrl}${path}`, {
      params: this.toHttpParams(queryParams),
    });
  }

  private toHttpParams(queryParams?: Record<string, QueryParamValue>): HttpParams {
    let params = new HttpParams();

    if (!queryParams) {
      const selectedHotelId = this.auth.selectedHotelId();
      if (selectedHotelId) {
        params = params.set('hotelId', String(selectedHotelId));
      }
      return params;
    }

    for (const [key, value] of Object.entries(queryParams)) {
      if (value === null || value === undefined || value === '') {
        continue;
      }

      params = params.set(key, String(value));
    }

    const selectedHotelId = this.auth.selectedHotelId();
    if (selectedHotelId) {
      params = params.set('hotelId', String(selectedHotelId));
    }

    return params;
  }
}
