import { Routes } from '@angular/router';
import { AlertsPageComponent } from './features/alerts/alerts-page.component';
import { ConfigurationPageComponent } from './features/configuration/configuration-page.component';
import { RecommendationsPageComponent } from './features/recommendations/recommendations-page.component';
import { ReportsPageComponent } from './features/reports/reports-page.component';
import { RevenueIntelligencePageComponent } from './features/revenue-intelligence/revenue-intelligence-page.component';
import { UploadPageComponent } from './features/upload/upload-page.component';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'revenue-intelligence',
  },
  {
    path: 'dashboard',
    redirectTo: 'revenue-intelligence',
  },
  {
    path: 'upload',
    component: UploadPageComponent,
    title: 'RevSight | Ingesta de Datos',
  },
  {
    path: 'recommendations',
    component: RecommendationsPageComponent,
    title: 'RevSight | Action Center',
  },
  {
    path: 'revenue-intelligence',
    component: RevenueIntelligencePageComponent,
    title: 'RevSight | Revenue Intelligence',
  },
  {
    path: 'alerts',
    component: AlertsPageComponent,
    title: 'RevSight | Alerts Center',
  },
  {
    path: 'reports',
    component: ReportsPageComponent,
    title: 'RevSight | Reports & Exports',
  },
  {
    path: 'configuration',
    component: ConfigurationPageComponent,
    title: 'RevSight | Configuracion',
  },
  {
    path: '**',
    redirectTo: 'revenue-intelligence',
  },
];
