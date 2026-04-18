import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  readonly navItems = [
    { label: 'Dashboard', icon: 'insights', path: '/dashboard' },
    { label: 'Upload', icon: 'upload_file', path: '/upload' },
    { label: 'Recommendations', icon: 'lightbulb', path: '/recommendations' },
    { label: 'Alerts', icon: 'notifications_active', path: '/alerts' }
  ];
}
