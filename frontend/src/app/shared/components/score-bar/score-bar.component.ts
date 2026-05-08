import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-score-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './score-bar.component.html',
  styleUrl: './score-bar.component.scss',
})
export class ScoreBarComponent {
  value = input.required<number>();
  tone = input<'opportunity' | 'risk' | 'neutral'>('neutral');
}
