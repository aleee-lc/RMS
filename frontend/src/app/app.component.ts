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
    MatButtonModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly navGroups = [
    {
      label: 'Command',
      items: [
        { label: 'Revenue Command Center', icon: 'monitoring', path: '/revenue-intelligence' },
      ],
    },
    {
      label: 'Actions',
      items: [
        { label: 'Action Center', icon: 'task_alt', path: '/recommendations' },
        { label: 'Alerts Center', icon: 'notifications_active', path: '/alerts' },
      ],
    },
    {
      label: 'Data',
      items: [
        { label: 'Upload Center', icon: 'upload_file', path: '/upload' },
        { label: 'Reports & Exports', icon: 'summarize', path: '/reports' },
      ],
    },
    {
      label: 'Admin',
      items: [{ label: 'Configuration', icon: 'settings', path: '/configuration' }],
    },
  ];
}
