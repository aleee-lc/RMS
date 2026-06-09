import { Routes } from '@angular/router';
import { AlertsPageComponent } from './features/alerts/alerts-page.component';
import { ConfigurationPageComponent } from './features/configuration/configuration-page.component';
import { RecommendationsPageComponent } from './features/recommendations/recommendations-page.component';
import { ReportsPageComponent } from './features/reports/reports-page.component';
import { RevenueCalendarPageComponent } from './features/revenue-calendar/revenue-calendar-page.component';
import { RevenueIntelligencePageComponent } from './features/revenue-intelligence/revenue-intelligence-page.component';
import { UploadPageComponent } from './features/upload/upload-page.component';
import { RatePlanGovernancePageComponent } from './features/rate-plan-governance/rate-plan-governance-page.component';
import { LandingPageComponent } from './features/landing/landing-page.component';
import { LoginPageComponent } from './features/login/login-page.component';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    component: LandingPageComponent,
    title: 'RevSight | Revenue Management BI',
    data: { shell: false },
  },
  {
    path: 'landing',
    component: LandingPageComponent,
    title: 'RevSight | Revenue Management BI',
    data: { shell: false },
  },
  {
    path: 'login',
    component: LoginPageComponent,
    title: 'RevSight | Login',
    data: { shell: false },
  },
  {
    path: 'dashboard',
    redirectTo: 'revenue-command',
  },
  {
    path: 'revenue-intelligence',
    redirectTo: 'revenue-command',
  },
  {
    path: 'rate-plan-governance',
    component: RatePlanGovernancePageComponent,
    title: 'RevSight | Rate Plan Governance',
    canActivate: [authGuard],
  },
  {
    path: 'upload',
    component: UploadPageComponent,
    title: 'RevSight | Ingesta de Datos',
    canActivate: [authGuard],
  },
  {
    path: 'recommendations',
    component: RecommendationsPageComponent,
    title: 'RevSight | Action Center',
    canActivate: [authGuard],
  },
  {
    path: 'revenue-command',
    component: RevenueIntelligencePageComponent,
    title: 'RevSight | Revenue Command',
    canActivate: [authGuard],
  },
  {
    path: 'revenue-calendar',
    component: RevenueCalendarPageComponent,
    title: 'RevSight | Revenue Calendar',
    canActivate: [authGuard],
  },
  {
    path: 'alerts',
    component: AlertsPageComponent,
    title: 'RevSight | Alerts Center',
    canActivate: [authGuard],
  },
  {
    path: 'reports',
    component: ReportsPageComponent,
    title: 'RevSight | Reports & Exports',
    canActivate: [authGuard],
  },
  {
    path: 'configuration',
    component: ConfigurationPageComponent,
    title: 'RevSight | Configuracion',
    canActivate: [authGuard],
  },
  {
    path: '**',
    redirectTo: 'revenue-command',
  },
];
