import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

type Tile = {
  title: string;
  subtitle: string;
  route: string;
  accent: string;
};

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="hero">
      <div class="hero-left">
        <div class="logo">📈</div>
        <div>
          <h1>Dashboard de Supervision Temps Réel</h1>
          <p>SUMO → Kafka → Spring → PostgreSQL → Angular</p>
        </div>
      </div>
    </div>

    <div class="grid">
      @for (t of tiles; track t.title) {
        <a class="tile" [style.borderTopColor]="t.accent" [routerLink]="t.route">
          <div class="tile-title">{{ t.title }}</div>
          <div class="tile-sub">{{ t.subtitle }}</div>
        </a>
      }
    </div>
  `,
  styles: [
    `
      .hero {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1.25rem;
      }
      .hero-left {
        display: flex;
        gap: 1rem;
        align-items: center;
      }
      .logo {
        width: 54px;
        height: 54px;
        border-radius: 14px;
        display: grid;
        place-items: center;
        background: rgba(0, 255, 255, 0.08);
        border: 1px solid rgba(0, 255, 255, 0.22);
      }
      h1 {
        font-size: 1.7rem;
        margin: 0;
        letter-spacing: 0.2px;
      }
      p {
        margin: 0.25rem 0 0;
        color: rgba(232, 238, 252, 0.72);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 1rem;
      }

      @media (max-width: 950px) {
        .grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 640px) {
        .grid {
          grid-template-columns: 1fr;
        }
      }

      .tile {
        display: block;
        text-decoration: none;
        color: inherit;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-top: 4px solid rgba(0, 255, 255, 0.3);
        background: rgba(255, 255, 255, 0.03);
        border-radius: 16px;
        padding: 1.25rem;
        min-height: 130px;
        transition: transform 120ms ease, background 120ms ease;
      }

      .tile:hover {
        transform: translateY(-2px);
        background: rgba(255, 255, 255, 0.05);
      }

      .tile-title {
        font-weight: 700;
        font-size: 1.1rem;
        margin-bottom: 0.5rem;
      }

      .tile-sub {
        color: rgba(232, 238, 252, 0.7);
        line-height: 1.35;
        font-size: 0.95rem;
      }
    `
  ]
})
export class HomePage {
  protected readonly tiles: Tile[] = [
    {
      title: 'Vue Globale',
      subtitle: 'KPIs + graphiques évolution densité, vitesse, congestion',
      route: '/overview',
      accent: '#22d3ee'
    },
    {
      title: 'Carte Réseau',
      subtitle: 'Canvas HTML5 — grille, nœuds, phases en direct',
      route: '/network',
      accent: '#3b82f6'
    },
    {
      title: 'Feux & Timers',
      subtitle: 'Timer countdown, densité par bras, phases',
      route: '/signals',
      accent: '#22c55e'
    },
    {
      title: 'Incidents',
      subtitle: 'Journal accidents/travaux, sévérité, impact',
      route: '/incidents',
      accent: '#f97316'
    },
    {
      title: 'Analyse',
      subtitle: 'Top carrefours, distribution phases, temps d’attente',
      route: '/analysis',
      accent: '#a855f7'
    },
    {
      title: 'Comparaison',
      subtitle: 'Feux adaptatifs vs cycles fixes — réduction TAM (%)',
      route: '/comparison',
      accent: '#ef4444'
    }
  ];
}
