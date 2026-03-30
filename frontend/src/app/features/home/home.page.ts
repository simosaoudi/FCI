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
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss'
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
