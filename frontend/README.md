# RMS Frontend (Angular)

Interfaz Angular para el MVP de Revenue Management hotelero.

## Requisitos

- Node.js 20+
- Backend NestJS corriendo en `http://localhost:3000`

## Configuración

Edita [src/environments/environment.ts](./src/environments/environment.ts):

```ts
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:3000',
  defaultHotelId: 1
};
```

## Ejecutar

```bash
npm install
npm start
```

App local: `http://localhost:4200`

## Build producción

```bash
npm run build
```

## Funcionalidades

- **Upload**
  - Subida XML (`/upload/xml`)
  - Subida Excel (`/upload/excel`)
  - Muestra respuesta resumida del backend

- **Dashboard**
  - Filtro de fechas
  - KPIs: ocupación promedio, ADR, revenue, alertas activas
  - Gráfica de líneas (ocupación, ADR, revenue)

- **Recommendations**
  - Tabla de recomendaciones con acción, precio sugerido y explicación
  - Filtro de fechas y botón refresh

- **Alerts**
  - Tabla de alertas
  - Filtro por fechas y estado (activas/resueltas)

## Estructura

```txt
src/app/
  core/
    models/
    services/
    interceptors/
  shared/
    components/
      kpi-card/
      date-range-filter/
      action-badge/
  features/
    upload/
    dashboard/
    recommendations/
    alerts/
  app.routes.ts
  app.component.ts
```

## Supuestos

- Se usa `hotelId = 1` por defecto.
- El backend ya aplica lógica de recomendaciones/alertas.
- Errores HTTP se muestran con snackbar global.
