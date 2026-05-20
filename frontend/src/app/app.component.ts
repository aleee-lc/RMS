import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { filter } from 'rxjs';
import { AuthService } from './core/services/auth.service';

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
    MatFormFieldModule,
    MatSelectModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly auth = inject(AuthService);

  readonly showShell = signal(true);
  readonly mobileMenuOpen = signal(false);
  readonly user = this.auth.user;
  readonly hotels = this.auth.hotels;
  readonly selectedHotelId = this.auth.selectedHotelId;

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

  constructor(private readonly router: Router) {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => this.updateShellVisibility());

    queueMicrotask(() => this.updateShellVisibility());
  }

  onHotelChanged(hotelId: number): void {
    this.auth.selectHotel(hotelId);
    window.location.reload();
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((open) => !open);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  onLogout(): void {
    this.auth.logout();
  }

  private updateShellVisibility(): void {
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) {
      route = route.firstChild;
    }

    this.showShell.set(route.data['shell'] !== false);
  }
}
