import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { catchError, throwError } from 'rxjs';

function resolveErrorMessage(error: HttpErrorResponse): string {
  if (typeof error.error === 'string' && error.error.trim()) {
    return error.error;
  }

  if (error.error && typeof error.error === 'object' && 'message' in error.error) {
    const maybeMessage = error.error.message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }
  }

  if (error.status === 0) {
    return 'No se pudo conectar al backend. Verifica que NestJS esté corriendo.';
  }

  return error.message || 'Ocurrió un error inesperado.';
}

export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const snackBar = inject(MatSnackBar);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      snackBar.open(resolveErrorMessage(error), 'Cerrar', {
        duration: 5000,
        horizontalPosition: 'right',
        verticalPosition: 'top'
      });
      return throwError(() => error);
    })
  );
};
