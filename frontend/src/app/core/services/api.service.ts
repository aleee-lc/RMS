import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type QueryParamValue = string | number | boolean | null | undefined;

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  get<T>(path: string, queryParams?: Record<string, QueryParamValue>): Observable<T> {
    return this.http.get<T>(`${this.baseUrl}${path}`, {
      params: this.toHttpParams(queryParams)
    });
  }

  post<T>(path: string, body: unknown, queryParams?: Record<string, QueryParamValue>): Observable<T> {
    return this.http.post<T>(`${this.baseUrl}${path}`, body, {
      params: this.toHttpParams(queryParams)
    });
  }

  patch<T>(path: string, body: unknown, queryParams?: Record<string, QueryParamValue>): Observable<T> {
    return this.http.patch<T>(`${this.baseUrl}${path}`, body, {
      params: this.toHttpParams(queryParams)
    });
  }

  delete<T>(path: string, queryParams?: Record<string, QueryParamValue>): Observable<T> {
    return this.http.delete<T>(`${this.baseUrl}${path}`, {
      params: this.toHttpParams(queryParams)
    });
  }

  private toHttpParams(queryParams?: Record<string, QueryParamValue>): HttpParams {
    let params = new HttpParams();

    if (!queryParams) {
      return params;
    }

    for (const [key, value] of Object.entries(queryParams)) {
      if (value === null || value === undefined || value === '') {
        continue;
      }

      params = params.set(key, String(value));
    }

    return params;
  }
}
