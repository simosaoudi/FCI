import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-back-button',
  standalone: true,
  imports: [],
  template: `
    <button class="back-btn" type="button" (click)="goHome()" title="Retour au tableau de bord">
      <svg class="back-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5z"/>
        <polyline points="9 21 9 12 15 12 15 21"/>
      </svg>
      <span class="back-label">Accueil</span>
    </button>
  `,
  styles: [`
    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 5px 12px 5px 8px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.05);
      color: rgba(232,238,252,0.7);
      text-decoration: none;
      font-size: 0.8rem;
      font-weight: 500;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      cursor: pointer;
    }
    .back-btn:hover {
      background: rgba(255,255,255,0.1);
      color: #e8eefc;
      border-color: rgba(255,255,255,0.22);
    }
    .back-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }
    .back-label {
      line-height: 1;
    }
  `]
})
export class BackButtonComponent {
  private readonly router = inject(Router);
  goHome(): void { this.router.navigate(['/']); }
}
