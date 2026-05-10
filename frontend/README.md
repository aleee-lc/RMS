# RevSight Frontend

Angular interface for the hotel Revenue Management MVP. The app consumes the NestJS backend and brings together data ingestion, revenue intelligence, recommendations, alerts, reports, and operational configuration.

## Stack

- Angular 21
- Angular Material
- Chart.js + ng2-charts
- RxJS
- TypeScript

## Requirements

- Node.js 20+
- Backend running at `http://localhost:3000`

## Configuration

Edit `src/environments/environment.ts`:

```ts
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:3000',
  defaultHotelId: 1
};
```

## Run

```bash
npm install
npm start
```

Local app: `http://localhost:4200`

## Build

```bash
npm run build
```

## Tests

```bash
npm test
```

## Navigation

The root route redirects to `/revenue-intelligence`.

- `/revenue-intelligence`: Revenue Command Center
- `/recommendations`: Action Center
- `/alerts`: Alerts Center
- `/upload`: Upload Center
- `/reports`: Reports & Exports
- `/configuration`: Configuration
- `/dashboard`: legacy redirect to `/revenue-intelligence`

## Features

### Revenue Command Center

- Executive summary for the selected date range.
- Daily revenue calendar.
- KPIs for revenue, occupancy, ADR, alerts, and opportunities.
- Pickup, forecast, competitive-set, and recommendation context by date.
- CSV/PDF exports from BI endpoints.

### Action Center

- Recommendation lookup by date range.
- Manual recommendation generation.
- `increase`, `decrease`, and `hold` actions.
- Suggested price, occupancy, own price, and market-average visibility.

### Alerts Center

- Alert lookup by date range and status.
- Alert resolution and reactivation.
- Normalized severities for operational prioritization.

### Upload Center

- XML upload to `/upload/xml`.
- Excel upload to `/upload/excel`.
- Backend response summary.
- Pre-upload validations.

### Reports & Exports

- Pickup reports.
- Forecast variance.
- Market position.
- Recommendation compliance.
- Revenue opportunity.
- Executive summary.
- CRS reconciliation.

### Configuration

- Base hotel management.
- Competitor management.
- Recommendation rule settings.
- Rate-shopping and snapshot integration.

## Structure

```txt
src/app/
  core/
    models/
    services/
    interceptors/
  shared/
    components/
      action-badge/
      date-range-filter/
      kpi-card/
  features/
    alerts/
    configuration/
    dashboard/
    recommendations/
    reports/
    revenue-intelligence/
    upload/
  app.routes.ts
  app.component.ts
```

## Main API Services

- `ApiService`: base HTTP wrapper.
- `BiService`: `/bi/revenue-calendar`, `/bi/executive-summary`, `/bi/export/csv`, `/bi/export/pdf`.
- `ReportsService`: `/reports/*` endpoints.
- Feature services for metrics, recommendations, alerts, hotels, competitors, and configuration.

## Assumptions

- `defaultHotelId` defines the active hotel by default.
- The backend calculates and persists recommendations/alerts.
- HTTP errors are surfaced through global app feedback.
- Business configuration lives in the backend and is consumed by the configuration screen.
