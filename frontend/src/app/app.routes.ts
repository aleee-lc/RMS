import { Routes } from '@angular/router';
import { AlertsPageComponent } from './features/alerts/alerts-page.component';
import { DashboardPageComponent } from './features/dashboard/dashboard-page.component';
import { RecommendationsPageComponent } from './features/recommendations/recommendations-page.component';
import { UploadPageComponent } from './features/upload/upload-page.component';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard'
  },
  {
    path: 'dashboard',
    component: DashboardPageComponent,
    title: 'Dashboard RM'
  },
  {
    path: 'upload',
    component: UploadPageComponent,
    title: 'Ingesta de Datos'
  },
  {
    path: 'recommendations',
    component: RecommendationsPageComponent,
    title: 'Recomendaciones'
  },
  {
    path: 'alerts',
    component: AlertsPageComponent,
    title: 'Alertas'
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
