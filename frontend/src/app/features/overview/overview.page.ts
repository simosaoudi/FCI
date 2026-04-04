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
import { BackButtonComponent } from '../../shared/back-button/back-button.component';

const HISTORY = 80; // steps to keep in sparklines

type ZoneDensity = { zone: string; halted: number; total: number };

@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [CommonModule, BackButtonComponent],
  templateUrl: './overview.page.html',
  styleUrl: './overview.page.scss',
})
export class OverviewPage implements AfterViewInit, OnDestroy {
  @ViewChild('vehicleCanvas')  private vehicleCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('speedCanvas')    private speedCanvasRef?:   ElementRef<HTMLCanvasElement>;
  @ViewChild('congestCanvas')  private congestCanvasRef?: ElementRef<HTMLCanvasElement>;

  // ── Signals ──────────────────────────────────────────────────
  protected readonly connected = computed(() => this.ws.connected());
  protected readonly totalVehicles  = signal(0);
  protected readonly averageSpeed   = signal(0);
  protected readonly congestionPct  = signal(0);
  protected readonly totalHalted    = signal(0);
  protected readonly scenario       = signal('—');
  protected readonly tlsMode        = signal('—');
  protected readonly zoneDensities  = signal<ZoneDensity[]>([]);

  protected readonly congestionLevel = computed<'low' | 'medium' | 'high'>(() => {
    const p = this.congestionPct();
    if (p < 25) return 'low';
    if (p < 55) return 'medium';
    return 'high';
  });

  // ── History arrays (for sparklines) ─────────────────────────
  private readonly vehicleHist:  number[] = [];
  private readonly speedHist:    number[] = [];
  private readonly congestHist:  number[] = [];

  constructor(private readonly ws: TrafficWsService) {
    effect(() => {
      const snap = this.ws.lastMessage();
      if (!snap) return;

      // Total vehicles + avg speed from vehicle list
      const vehicles = snap.vehicles ?? [];
      const count = snap.totalVehicles ?? vehicles.length;
      this.totalVehicles.set(count);

      if (vehicles.length > 0) {
        const sumSpeed = vehicles.reduce((s, v) => s + (v.speed ?? 0), 0);
        const avgKmh = Math.round((sumSpeed / vehicles.length) * 3.6);
        this.averageSpeed.set(avgKmh);
      }

      if (snap.scenario) this.scenario.set(snap.scenario);
      if (snap.tlsMode)  this.tlsMode.set(snap.tlsMode);
    });

    effect(() => {
      // Aggregate across all TLS
      const all = Object.values(this.ws.snapshotsByTlsId());
      const halted = all.reduce((s, sn) => s + sn.totalHalted, 0);
      this.totalHalted.set(halted);

      const count = this.totalVehicles();
      const pct = count > 0 ? Math.min(100, Math.round((halted / count) * 100)) : 0;
      this.congestionPct.set(pct);

      // Zone density: group TLS by row letter (A=col0…D=col3 → rows 0,1,2 by second char)
      const zoneMap = new Map<string, { halted: number; count: number }>();
      for (const sn of all) {
        const row = sn.tlsId.slice(-1); // last char = row digit
        const key = `Rangée ${row}`;
        const prev = zoneMap.get(key) ?? { halted: 0, count: 0 };
        const laneVehicles = Object.values(sn.lanes ?? {}).reduce((s, n) => s + n, 0);
        zoneMap.set(key, { halted: prev.halted + sn.totalHalted, count: prev.count + laneVehicles });
      }
      const zones: ZoneDensity[] = [...zoneMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([zone, v]) => ({ zone, halted: v.halted, total: v.count }));
      this.zoneDensities.set(zones);

      // Update history + redraw
      this.push(this.vehicleHist,  this.totalVehicles());
      this.push(this.speedHist,    this.averageSpeed());
      this.push(this.congestHist,  this.congestionPct());
      this.drawAll();
    });
  }

  ngAfterViewInit(): void {
    this.drawAll();
  }

  ngOnDestroy(): void {}

  private push(arr: number[], val: number): void {
    arr.push(val);
    if (arr.length > HISTORY) arr.shift();
  }

  // ── Canvas helpers ────────────────────────────────────────────

  private drawAll(): void {
    this.drawLine(this.vehicleCanvasRef, this.vehicleHist, '#38bdf8', 'rgba(56,189,248,0.12)');
    this.drawLine(this.speedCanvasRef,   this.speedHist,   '#22c55e', 'rgba(34,197,94,0.12)');
    this.drawLine(this.congestCanvasRef, this.congestHist, '#f97316', 'rgba(249,115,22,0.12)');
  }

  private drawLine(
    ref: ElementRef<HTMLCanvasElement> | undefined,
    data: number[],
    stroke: string,
    fill: string,
  ): void {
    const canvas = ref?.nativeElement;
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const maxVal = Math.max(...data, 1);
    const pts = data.map((v, i) => ({
      x: (i / (HISTORY - 1)) * w,
      y: h - 4 - (v / maxVal) * (h - 8),
    }));

    // Area
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineTo(pts[pts.length - 1].x, h);
    ctx.lineTo(pts[0].x, h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // ── Template helpers ─────────────────────────────────────────

  protected maxZone(zones: ZoneDensity[]): number {
    return Math.max(1, ...zones.map(z => z.halted));
  }

  protected zoneBarWidth(zone: ZoneDensity, zones: ZoneDensity[]): string {
    return `${Math.round((zone.halted / this.maxZone(zones)) * 100)}%`;
  }

  protected trackZone(_: number, z: ZoneDensity): string { return z.zone; }
}
