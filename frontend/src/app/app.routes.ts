import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./layout/shell.page').then((m) => m.ShellPage),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage)
      },
      {
        path: 'network',
        loadComponent: () => import('./pages/network/network.page').then((m) => m.NetworkPage)
      },
      {
        path: 'overview',
        loadComponent: () => import('./pages/placeholder/placeholder.page').then((m) => m.PlaceholderPage),
        data: { title: 'Vue Globale' }
      },
      {
        path: 'signals',
        loadComponent: () => import('./pages/placeholder/placeholder.page').then((m) => m.PlaceholderPage),
        data: { title: 'Feux & Timers' }
      },
      {
        path: 'incidents',
        loadComponent: () => import('./pages/placeholder/placeholder.page').then((m) => m.PlaceholderPage),
        data: { title: 'Incidents' }
      },
      {
        path: 'analysis',
        loadComponent: () => import('./pages/placeholder/placeholder.page').then((m) => m.PlaceholderPage),
        data: { title: 'Analyse' }
      },
      {
        path: 'comparison',
        loadComponent: () => import('./pages/placeholder/placeholder.page').then((m) => m.PlaceholderPage),
        data: { title: 'Comparaison' }
      }
    ]
  }
];
