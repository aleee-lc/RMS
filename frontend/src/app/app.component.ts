import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatIconModule,
    MatButtonModule
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  readonly navItems = [
    { label: 'Dashboard', icon: 'monitoring', path: '/dashboard' },
    { label: 'Ingesta', icon: 'upload_file', path: '/upload' },
    { label: 'Recomendaciones', icon: 'lightbulb', path: '/recommendations' },
    { label: 'Alertas', icon: 'notifications_active', path: '/alerts' },
    { label: 'Reportes', icon: 'summarize', path: '/reports' },
    { label: 'Configuracion', icon: 'settings', path: '/configuration' }
  ];
}
