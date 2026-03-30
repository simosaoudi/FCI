import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

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
        loadComponent: () => import('./features/network/network.page').then((m) => m.NetworkPage),
        canActivate: [authGuard],
        data: { roles: ['admin', 'operateur', 'viewer'] }
      },
      {
        path: 'overview',
        loadComponent: () => import('./features/placeholder/placeholder.page').then((m) => m.PlaceholderPage),
        canActivate: [authGuard],
        data: { title: 'Vue Globale', roles: ['admin', 'operateur', 'viewer'] }
      },
      {
        path: 'signals',
        loadComponent: () => import('./features/placeholder/placeholder.page').then((m) => m.PlaceholderPage),
        canActivate: [authGuard],
        data: { title: 'Feux & Timers', roles: ['admin', 'operateur', 'viewer'] }
      },
      {
        path: 'incidents',
        loadComponent: () => import('./features/placeholder/placeholder.page').then((m) => m.PlaceholderPage),
        canActivate: [authGuard],
        data: { title: 'Incidents', roles: ['admin', 'operateur', 'viewer'] }
      },
      {
        path: 'analysis',
        loadComponent: () => import('./features/placeholder/placeholder.page').then((m) => m.PlaceholderPage),
        canActivate: [authGuard],
        data: { title: 'Analyse', roles: ['admin', 'operateur', 'viewer'] }
      },
      {
        path: 'comparison',
        loadComponent: () => import('./features/placeholder/placeholder.page').then((m) => m.PlaceholderPage),
        canActivate: [authGuard],
        data: { title: 'Comparaison', roles: ['admin', 'operateur', 'viewer'] }
      }
    ]
  }
];
