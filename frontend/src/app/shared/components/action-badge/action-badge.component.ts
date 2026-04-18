import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { RecommendationAction } from '../../../core/models/recommendation.model';

@Component({
  selector: 'app-action-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './action-badge.component.html',
  styleUrl: './action-badge.component.scss'
})
export class ActionBadgeComponent {
  action = input.required<RecommendationAction>();

  labelMap: Record<RecommendationAction, string> = {
    increase: 'Aumentar',
    decrease: 'Disminuir',
    hold: 'Mantener'
  };

  badgeClass(action: RecommendationAction): string {
    return `badge-${action}`;
  }
}
