import { CommonModule } from '@angular/common';
import { Component, HostListener, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [CommonModule, RouterLink, MatIconModule],
  templateUrl: './landing-page.component.html',
  styleUrl: './landing-page.component.scss',
})
export class LandingPageComponent {
  readonly scrollProgress = signal(0);

  readonly metrics = [
    { value: '+18%', label: 'RevPAR objetivo' },
    { value: '24/7', label: 'Senales activas' },
    { value: '360', label: 'Vista competitiva' },
  ];

  readonly capabilities = [
    {
      icon: 'monitoring',
      title: 'Command Center',
      text: 'Ocupacion, ADR, RevPAR, pickup y senales criticas en una sola pantalla operativa.',
    },
    {
      icon: 'price_check',
      title: 'Pricing accionable',
      text: 'Recomendaciones claras para subir, mantener o ajustar tarifas segun demanda y mercado.',
    },
    {
      icon: 'travel_explore',
      title: 'Rate shopping',
      text: 'Compara tu posicion tarifaria contra competidores y detecta brechas antes de perder demanda.',
    },
    {
      icon: 'summarize',
      title: 'Reportes ejecutivos',
      text: 'Forecast, pickup, cumplimiento y oportunidades listos para tomar decisiones con direccion.',
    },
  ];

  readonly story = [
    {
      kicker: '01 / Detecta',
      title: 'Cada fecha cuenta su propia historia.',
      text: 'RevSight ordena reservas, tarifas y pickup para revelar dias con oportunidad, riesgo o presion competitiva.',
    },
    {
      kicker: '02 / Decide',
      title: 'La recomendacion llega antes de que el mercado se mueva.',
      text: 'El sistema cruza ocupacion, llegada, ritmo y comp set para sugerir la accion tarifaria mas defendible.',
    },
    {
      kicker: '03 / Ejecuta',
      title: 'Menos ruido, mas disciplina de revenue.',
      text: 'Alertas, reportes y seguimiento de cumplimiento mantienen al equipo enfocado en lo que cambia ingresos.',
    },
  ];

  @HostListener('window:scroll')
  onWindowScroll(): void {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    this.scrollProgress.set(maxScroll > 0 ? Math.min(window.scrollY / maxScroll, 1) : 0);
  }
}
