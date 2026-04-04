import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./layout/shell.page').then((m) => m.ShellPage),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./features/home/home.page').then((m) => m.HomePage)
      },
      {
        path: 'network',
        loadComponent: () => import('./features/network/network.page').then((m) => m.NetworkPage)
      },
      {
        path: 'overview',
        loadComponent: () => import('./features/overview/overview.page').then((m) => m.OverviewPage)
      },
      {
        path: 'signals',
        loadComponent: () => import('./features/signals/signals.page').then((m) => m.SignalsPage)
      },
      {
        path: 'incidents',
        loadComponent: () => import('./features/placeholder/placeholder.page').then((m) => m.PlaceholderPage)
      },
      {
        path: 'analysis',
        loadComponent: () => import('./features/analysis/analysis.page').then((m) => m.AnalysisPage)
      },
      {
        path: 'comparison',
        loadComponent: () => import('./features/placeholder/placeholder.page').then((m) => m.PlaceholderPage)
      }
    ]
  }
];
