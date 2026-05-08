import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-market-position-cell',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './market-position-cell.component.html',
  styleUrl: './market-position-cell.component.scss',
})
export class MarketPositionCellComponent {
  gapPct = input<number | null>(null);
  rank = input<number | null>(null);
  rankTotal = input<number>(0);
}
