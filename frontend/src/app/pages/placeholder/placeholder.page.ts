import { CommonModule } from '@angular/common';
import { Component, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-placeholder',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card">
      <h2>{{ title() }}</h2>
      <p>Page en cours de développement.</p>
    </div>
  `,
  styles: [
    `
      .card {
        padding: 1rem;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.03);
      }
      h2 {
        margin: 0 0 0.35rem;
      }
      p {
        margin: 0;
        color: rgba(232, 238, 252, 0.75);
      }
    `
  ]
})
export class PlaceholderPage {
  protected readonly title = computed(() => (this.route.snapshot.data['title'] as string) ?? 'Page');

  constructor(private readonly route: ActivatedRoute) {}
}
