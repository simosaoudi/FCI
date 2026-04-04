import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { TrafficWsService } from '../../core/services/traffic-ws.service';
import { TrafficSnapshot } from '../../core/models';
import { BackButtonComponent } from '../../shared/back-button/back-button.component';

/** Top-N lanes by vehicle count, derived from a snapshot's `lanes` map. */
type LaneDensity = { id: string; count: number };

/** Processed card data for one TLS intersection. */
type TlsCard = {
  id: string;
  phase: number;
  tlState: string;
  remainingTime: number;
  totalHalted: number;
  topLanes: LaneDensity[];
  /** Dominant signal color: 'green' | 'yellow' | 'red' */
  color: 'green' | 'yellow' | 'red';
  /** Per-signal-state counts */
  greenCount: number;
  yellowCount: number;
  redCount: number;
};

function dominantColor(tlState: string): 'green' | 'yellow' | 'red' {
  let g = 0, y = 0, r = 0;
  for (const ch of tlState) {
    if (ch === 'G' || ch === 'g') g++;
    else if (ch === 'y' || ch === 'Y') y++;
    else r++;
  }
  if (g > 0) return 'green';
  if (y > 0) return 'yellow';
  return 'red';
}

function signalCounts(tlState: string): { g: number; y: number; r: number } {
  let g = 0, y = 0, r = 0;
  for (const ch of tlState) {
    if (ch === 'G' || ch === 'g') g++;
    else if (ch === 'y' || ch === 'Y') y++;
    else r++;
  }
  return { g, y, r };
}

function topLanes(lanes: Record<string, number>, n = 4): LaneDensity[] {
  return Object.entries(lanes)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

function buildCard(snap: TrafficSnapshot): TlsCard {
  const tlState = snap.tlState ?? '';
  const color = tlState ? dominantColor(tlState) : 'red';
  const { g, y, r } = signalCounts(tlState);
  return {
    id: snap.tlsId,
    phase: snap.phase,
    tlState,
    remainingTime: snap.remainingTime ?? 0,
    totalHalted: snap.totalHalted,
    topLanes: topLanes(snap.lanes ?? {}),
    color,
    greenCount: g,
    yellowCount: y,
    redCount: r,
  };
}

@Component({
  selector: 'app-signals',
  standalone: true,
  imports: [CommonModule, BackButtonComponent],
  templateUrl: './signals.page.html',
  styleUrl: './signals.page.scss',
})
export class SignalsPage {
  protected readonly connected = computed(() => this.ws.connected());

  /** All TLS cards sorted by ID for stable grid layout. */
  protected readonly cards = computed<TlsCard[]>(() => {
    const snaps = this.ws.snapshotsByTlsId();
    return Object.values(snaps)
      .map(buildCard)
      .sort((a, b) => a.id.localeCompare(b.id));
  });

  /** Global summary counts across all TLS. */
  protected readonly summary = computed(() => {
    const all = this.cards();
    const totalHalted = all.reduce((s, c) => s + c.totalHalted, 0);
    const green = all.filter(c => c.color === 'green').length;
    const red   = all.filter(c => c.color === 'red').length;
    const yellow = all.filter(c => c.color === 'yellow').length;
    return { totalHalted, green, red, yellow, total: all.length };
  });

  constructor(private readonly ws: TrafficWsService) {}

  protected maxDensity(lanes: LaneDensity[]): number {
    return Math.max(1, ...lanes.map(l => l.count));
  }

  protected trackById(_: number, card: TlsCard): string {
    return card.id;
  }

  /** Format lane ID to a short readable label, e.g. "A0B0_0" → "A0→B0" */
  protected laneLabel(id: string): string {
    const m = id.match(/^([A-Z]\d+)([A-Z]\d+)_\d+$/i);
    return m ? `${m[1]}→${m[2]}` : id;
  }
}
