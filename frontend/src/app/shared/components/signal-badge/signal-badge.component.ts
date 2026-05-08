import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-signal-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './signal-badge.component.html',
  styleUrl: './signal-badge.component.scss',
})
export class SignalBadgeComponent {
  label = input.required<string>();
  severity = input<'low' | 'medium' | 'high'>('low');
}
