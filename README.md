# RevSight RMS MVP

NestJS backend for a hotel Revenue Management MVP. It supports data ingestion, metric calculation, pricing recommendations, alerts, operational reports, rate shopping, and BI endpoints for the Angular frontend.

## Stack

- NestJS 10 + TypeScript
- PostgreSQL / Supabase-compatible database
- Prisma ORM
- ExcelJS for Expedia price grids
- fast-xml-parser for Opera/CRS reports
- Playwright for rate shopping

## Features

- XML ingestion for reservations, Opera History and Forecast, and CRS Room Rate Distribution.
- Excel ingestion for Expedia prices and competitive set data.
- Daily occupancy, ADR, revenue, and pickup calculations.
- Hotel, competitor, and market-rate persistence.
- Hotel-level configurable pricing recommendations.
- Actionable alerts with resolve/reactivate workflow.
- On-demand rate shopping and snapshot lookup.
- Reports for pickup, forecast variance, market position, recommendation compliance, revenue opportunity, executive summary, and CRS reconciliation.
- BI endpoints for the Revenue Command Center and CSV/PDF exports.

## Structure

```txt
src/
  app.module.ts
  main.ts
  common/
  prisma/
  ingestion/
  metrics/
  market/
  recommendation/
  alerts/
  reports/
  hotels/
  competitors/
  rate-shopping/
  bi/
prisma/
  schema.prisma
  migrations/
  seed.ts
frontend/
  src/app/
```

## Requirements

- Node.js 20+
- PostgreSQL/Supabase
- Environment variables based on `.env.example`

## Backend Setup

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

Local API: `http://localhost:3000`

Useful scripts:

```bash
npm run build
npm run test
npm run lint
npm run prisma:deploy
```

## Frontend Setup

```bash
cd frontend
npm install
npm start
```

Local app: `http://localhost:4200`

The frontend reads `apiBaseUrl` and `defaultHotelId` from `frontend/src/environments/environment.ts`.

## API

Endpoints accept optional `hotelId` where applicable. If omitted, the backend resolves the default hotel.

### Ingestion

#### `POST /upload/xml`

Multipart form-data:

- `file`: XML file
- Optional query: `hotelId`

Supports reservation XML, Opera History and Forecast, and CRS Room Rate Distribution.

#### `POST /upload/excel`

Multipart form-data:

- `file`: `.xlsx` or `.xls`
- Optional query: `hotelId`

Reads Expedia grids with own price, market average, and competitor prices.

### Hotels and Configuration

- `POST /hotels`: create hotel.
- `GET /hotels`: list hotels.
- `GET /hotels/:id`: get hotel.
- `PATCH /hotels/:id`: update hotel.
- `GET /hotels/:id/recommendation-settings`: get recommendation settings.
- `PATCH /hotels/:id/recommendation-settings`: update recommendation settings.

Hotel payload:

```json
{
  "code": "HOTEL-01",
  "name": "Demo Hotel",
  "totalRooms": 80,
  "currency": "MXN",
  "timezone": "America/Mexico_City"
}
```

Recommendation setting fields:

- `highOccupancyThreshold`
- `lowOccupancyThreshold`
- `significantDiffPct`
- `demandWeight`
- `marketWeight`
- `maxAdjustmentPct`
- `minActionStepPct`

### Competitors

- `POST /hotels/:hotelId/competitors`: create competitor.
- `GET /hotels/:hotelId/competitors`: list hotel competitors.
- `PATCH /competitors/:id`: update competitor.
- `DELETE /competitors/:id`: delete competitor.

Payload:

```json
{ "name": "Demo Competitor" }
```

### Metrics

#### `GET /metrics`

Query params:

- `hotelId`
- `startDate`
- `endDate`

Returns daily occupancy, ADR, and revenue metrics.

### Recommendations

#### `GET /recommendations`

Query params:

- `hotelId`
- `startDate`
- `endDate`

Returns `date`, `action`, `suggested_price`, `explanation`, `occupancy`, `your_price`, and `market_average`.

#### `POST /recommendations/generate`

Generates and persists recommendations for a date range. The request body can optionally include the same fields as `recommendation-settings` to override settings for that run only.

### Alerts

- `GET /alerts`: list alerts by `hotelId`, `startDate`, `endDate`, and `resolved`.
- `PATCH /alerts/:id/resolve`: mark alert as resolved.
- `PATCH /alerts/:id/activate`: reactivate alert.

### Rate Shopping

#### `POST /rate-shopping/run`

Runs a rate search and stores snapshots.

```json
{
  "hotelId": 1,
  "city": "Chihuahua",
  "checkInDate": "2026-05-15",
  "checkOutDate": "2026-05-16",
  "adults": 2,
  "includeHotelSelf": true,
  "competitorNames": ["Competitor Hotel"]
}
```

#### `GET /rate-shopping/snapshots`

Query params:

- `hotelId`
- `startDate`
- `endDate`
- `competitorName`
- `limit`

### Reports

All report endpoints accept optional `hotelId`.

- `GET /reports/pickup`
- `GET /reports/forecast-variance`
- `GET /reports/market-position`
- `GET /reports/recommendation-compliance`
- `GET /reports/revenue-opportunity`
- `GET /reports/executive-summary`
- `GET /reports/crs-reconciliation`

### BI / Revenue Command Center

- `GET /bi/revenue-calendar`: daily calendar with occupancy, pickup, forecast, recommendations, alerts, and competitive position.
- `GET /bi/executive-summary`: executive range summary.
- `GET /bi/pickup`: pickup intelligence.
- `GET /bi/forecast`: forecast intelligence.
- `GET /bi/comp-set`: competitive-set intelligence.
- `GET /bi/export/csv`: export BI calendar as CSV.
- `GET /bi/export/pdf`: export BI calendar as PDF.

Common query params:

- `hotelId`
- `startDate`
- `endDate`

## Examples

```bash
curl -X POST "http://localhost:3000/upload/xml?hotelId=1" \
  -F "file=@C:/path/OperaHistoryForecast.xml"

curl -X POST "http://localhost:3000/upload/excel?hotelId=1" \
  -F "file=@C:/path/expedia_price_grid.xlsx"

curl "http://localhost:3000/metrics?hotelId=1&startDate=2026-04-01&endDate=2026-04-15"

curl -X POST "http://localhost:3000/recommendations/generate?hotelId=1&startDate=2026-05-01&endDate=2026-05-31" \
  -H "Content-Type: application/json" \
  -d "{\"highOccupancyThreshold\":70,\"lowOccupancyThreshold\":30}"

curl "http://localhost:3000/bi/revenue-calendar?hotelId=1&startDate=2026-05-01&endDate=2026-05-31"

curl "http://localhost:3000/reports/crs-reconciliation?hotelId=1&startDate=2026-03-01&endDate=2026-03-31&whichDate=Confirmation"
```

## Data Model

Main entities:

- `Hotel`
- `RecommendationSettings`
- `ReservationRaw`
- `DailyMetrics`
- `MarketRates`
- `Competitor`
- `CompetitorMarketRates`
- `Recommendations`
- `Alerts`
- `CrsRoomRateDistributionSnapshot`
- `RateShopSnapshot`

Key relationships:

- A hotel owns reservations, metrics, competitors, rates, recommendations, alerts, and snapshots.
- `MarketRates` consolidates own price, market average, and competitor rates.
- `Recommendations` are generated per hotel and date; they can trigger `Alerts`.
- `RecommendationSettings` controls hotel-level pricing rules.
- `CrsRoomRateDistributionSnapshot` reconciles external CRS totals against RMS data.
- `RateShopSnapshot` stores prices found by rate-shopping runs.

## Production Notes

- Keep ingestion idempotent with unique keys and upserts.
- Run migrations with `npm run prisma:deploy` outside local development.
- Add authentication/authorization before real multi-tenant use.
- Move heavy recommendation/rate-shopping jobs to queues or production-grade schedulers.
- Validate scraping limits and policies before automating rate shopping.
