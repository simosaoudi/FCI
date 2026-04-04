import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrafficWsService } from '../../core/services/traffic-ws.service';
import { TrafficSnapshot } from '../../core/models';
import { BackButtonComponent } from '../../shared/back-button/back-button.component';

type IntersectionStat = {
  id: string;
  current: number;
  avg: number;
  peak: number;
};

type PhaseStats = { green: number; red: number; yellow: number };
type WaitStats = { avg: number; max: number; min: number };

const HISTORY_SIZE = 60;

@Component({
  selector: 'app-analysis',
  standalone: true,
  imports: [CommonModule, BackButtonComponent],
  templateUrl: './analysis.page.html',
  styleUrl: './analysis.page.scss',
})
export class AnalysisPage implements AfterViewInit, OnDestroy {
  @ViewChild('sparklineCanvas') private sparklineRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('pieCanvas') private pieRef?: ElementRef<HTMLCanvasElement>;

  // Rolling per-TLS history (last HISTORY_SIZE snapshots each)
  private readonly haltHistory = new Map<string, number[]>();
  // Global avg-halted history for sparkline
  private readonly globalWaitHistory: number[] = [];

  protected readonly topIntersections = signal<IntersectionStat[]>([]);
  protected readonly phaseStats = signal<PhaseStats>({ green: 0, red: 0, yellow: 0 });
  protected readonly waitStats = signal<WaitStats>({ avg: 0, max: 0, min: 0 });
  protected readonly totalVehicles = signal(0);
  protected readonly scenario = signal('—');
  protected readonly tlsMode = signal('—');
  protected readonly connected = computed(() => this.ws.connected());

  // Max halted value seen, for bar scaling
  protected readonly maxHalted = signal(1);

  constructor(private readonly ws: TrafficWsService) {
    // React to every new snapshot arriving from the WebSocket
    effect(() => {
      const snap = this.ws.lastMessage();
      if (snap) this.ingest(snap);
    });

    // React to full snapshotsByTlsId map (recomputes top list whenever any TLS updates)
    effect(() => {
      const all = this.ws.snapshotsByTlsId();
      this.recomputeTopAndPhase(all);
    });
  }

  ngAfterViewInit(): void {
    this.drawPie();
    this.drawSparkline();
  }

  ngOnDestroy(): void {}

  // ─── Core ingestion ───────────────────────────────────────────

  private ingest(snap: TrafficSnapshot): void {
    // Update per-TLS halting history
    const id = snap.tlsId;
    if (!this.haltHistory.has(id)) this.haltHistory.set(id, []);
    const hist = this.haltHistory.get(id)!;
    hist.push(snap.totalHalted);
    if (hist.length > HISTORY_SIZE) hist.shift();

    // Update global state from latest snapshot
    if (snap.totalVehicles !== undefined) this.totalVehicles.set(snap.totalVehicles);
    if (snap.scenario) this.scenario.set(snap.scenario);
    if (snap.tlsMode) this.tlsMode.set(snap.tlsMode);

    // Update phase distribution from this TLS's laneSignalStates
    this.recomputePhase(this.ws.snapshotsByTlsId());

    // Update wait stats
    this.recomputeWaitStats();
  }

  private recomputeTopAndPhase(all: Record<string, TrafficSnapshot>): void {
    const stats: IntersectionStat[] = [];

    for (const [id, snap] of Object.entries(all)) {
      const hist = this.haltHistory.get(id) ?? [snap.totalHalted];
      const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
      const peak = Math.max(...hist);
      stats.push({ id, current: snap.totalHalted, avg, peak });
    }

    stats.sort((a, b) => b.avg - a.avg);
    this.topIntersections.set(stats);

    const peak = stats.reduce((m, s) => Math.max(m, s.peak), 1);
    this.maxHalted.set(peak);

    this.recomputePhase(all);
    this.recomputeWaitStats();
  }

  private recomputePhase(all: Record<string, TrafficSnapshot>): void {
    let g = 0, r = 0, y = 0;
    for (const snap of Object.values(all)) {
      const lss = snap.laneSignalStates;
      if (!lss) continue;
      for (const state of Object.values(lss)) {
        if (state === 'G' || state === 'g') g++;
        else if (state === 'r' || state === 'R') r++;
        else if (state === 'y' || state === 'Y') y++;
      }
    }
    const total = g + r + y || 1;
    this.phaseStats.set({
      green: Math.round((g / total) * 100),
      red: Math.round((r / total) * 100),
      yellow: Math.round((y / total) * 100),
    });
    this.drawPie();
  }

  private recomputeWaitStats(): void {
    const allHist = [...this.haltHistory.values()];
    if (allHist.length === 0) return;

    const currentValues = allHist.map(h => h[h.length - 1] ?? 0);
    const avg = currentValues.reduce((a, b) => a + b, 0) / currentValues.length;
    const max = Math.max(0, ...currentValues);
    const min = Math.min(...currentValues);

    this.waitStats.set({ avg: Math.round(avg * 10) / 10, max, min });

    this.globalWaitHistory.push(avg);
    if (this.globalWaitHistory.length > HISTORY_SIZE) this.globalWaitHistory.shift();
    this.drawSparkline();
  }

  // ─── Canvas drawing ───────────────────────────────────────────

  private drawPie(): void {
    const canvas = this.pieRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { green, red, yellow } = this.phaseStats();
    const total = (green + red + yellow) || 1;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const outerR = Math.min(cx, cy) - 6;
    const innerR = outerR * 0.56;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const segments = [
      { value: green, color: '#22c55e' },
      { value: red, color: '#ef4444' },
      { value: yellow, color: '#f59e0b' },
    ];

    let angle = -Math.PI / 2;
    for (const seg of segments) {
      if (seg.value === 0) continue;
      const sweep = (seg.value / total) * 2 * Math.PI;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outerR, angle, angle + sweep);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
      angle += sweep;
    }

    // Donut hole
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
    ctx.fillStyle = '#0d1424';
    ctx.fill();
  }

  private drawSparkline(): void {
    const canvas = this.sparklineRef?.nativeElement;
    if (!canvas || this.globalWaitHistory.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const data = this.globalWaitHistory;
    const maxVal = Math.max(...data, 1);

    const pts = data.map((v, i) => ({
      x: (i / (HISTORY_SIZE - 1)) * w,
      y: h - 4 - (v / maxVal) * (h - 8),
    }));

    // Area fill
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineTo(pts[pts.length - 1].x, h);
    ctx.lineTo(pts[0].x, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(168,85,247,0.12)';
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // ─── Template helpers ─────────────────────────────────────────

  protected barWidth(avg: number): string {
    const max = this.maxHalted();
    return `${Math.round((avg / max) * 100)}%`;
  }

  protected trackById(_: number, item: IntersectionStat): string {
    return item.id;
  }
}
