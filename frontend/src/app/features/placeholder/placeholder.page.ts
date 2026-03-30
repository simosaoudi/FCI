import { CommonModule } from '@angular/common';
import { Component, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-placeholder',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './placeholder.page.html',
  styleUrl: './placeholder.page.scss'
})
export class PlaceholderPage {
  protected readonly title = computed(() => (this.route.snapshot.data['title'] as string) ?? 'Page');

  constructor(private readonly route: ActivatedRoute) {}
}
