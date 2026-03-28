import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, computed, signal } from '@angular/core';
import { TrafficWsService } from '../../services/traffic-ws.service';

type LaneShape = {
  id: string;
  points: Array<{ x: number; y: number }>;
};

type NetData = {
  lanes: LaneShape[];
  lights: Array<{ id: string; x: number; y: number }>;
  junctions: Array<{ id: string; x: number; y: number; type: string }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

@Component({
  selector: 'app-network',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="wrap">
      <div class="panel">
        <h2>Carte Réseau</h2>
        <p>Dernier message: {{ msg()?.tlsId ?? '-' }} / step={{ msg()?.step ?? '-' }} / halted={{ msg()?.totalHalted ?? '-' }}</p>
      </div>

      <canvas #canvas class="canvas"></canvas>
    </div>
  `,
  styles: [
    `
      .wrap {
        display: grid;
        gap: 1rem;
      }
      .panel {
        padding: 0.9rem 1rem;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.03);
      }
      h2 {
        margin: 0 0 0.25rem;
      }
      p {
        margin: 0;
        color: rgba(232, 238, 252, 0.75);
      }
      .canvas {
        width: 100%;
        height: min(70vh, 720px);
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: #05060a;
      }
    `
  ]
})
export class NetworkPage implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) private canvasRef!: ElementRef<HTMLCanvasElement>;
  private raf: number | null = null;

  private readonly net = signal<NetData | null>(null);
  protected readonly netLoaded = computed(() => !!this.net());
  protected readonly netError = signal<string | null>(null);

  protected readonly msg = computed(() => this.ws.lastMessage());
  private readonly snapshotsByTlsId = computed(() => this.ws.snapshotsByTlsId());

  constructor(private readonly ws: TrafficWsService) {}

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
    };

    resize();
    window.addEventListener('resize', resize);

    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };

    this.raf = requestAnimationFrame(loop);

    this.destroy = () => {
      window.removeEventListener('resize', resize);
    };

    void this.loadNet();
  }

  private destroy: (() => void) | null = null;

  ngOnDestroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.destroy?.();
  }

  private draw(): void {
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const net = this.net();
    if (!net) {
      ctx.fillStyle = 'rgba(232, 238, 252, 0.7)';
      ctx.font = `${14 * dpr}px system-ui`;
      ctx.fillText(this.netError() ?? 'Chargement du réseau SUMO...', 16 * dpr, 26 * dpr);
      return;
    }

    const snapshot = this.msg();
    const haltedByLane = snapshot?.lanes ?? {};
    const byTls = this.snapshotsByTlsId();

    const padding = 30 * dpr;
    const innerW = Math.max(1, w - padding * 2);
    const innerH = Math.max(1, h - padding * 2);
    const spanX = Math.max(1e-6, net.bounds.maxX - net.bounds.minX);
    const spanY = Math.max(1e-6, net.bounds.maxY - net.bounds.minY);
    const scale = Math.min(innerW / spanX, innerH / spanY);

    const offsetX = padding + (innerW - spanX * scale) / 2;
    const offsetY = padding + (innerH - spanY * scale) / 2;

    const toCanvas = (p: { x: number; y: number }) => {
      const x = offsetX + (p.x - net.bounds.minX) * scale;
      // SUMO y goes up; canvas y goes down
      const y = offsetY + (net.bounds.maxY - p.y) * scale;
      return { x, y };
    };

    // Base roads
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.25 * dpr, 1);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    for (const lane of net.lanes) {
      if (lane.points.length < 2) continue;
      ctx.beginPath();
      const p0 = toCanvas(lane.points[0]);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < lane.points.length; i++) {
        const pi = toCanvas(lane.points[i]);
        ctx.lineTo(pi.x, pi.y);
      }
      ctx.stroke();
    }

    // Density overlay based on halted counts
    const maxHalted = this.maxValue(haltedByLane);
    if (maxHalted > 0) {
      ctx.lineWidth = Math.max(2.4 * dpr, 2);
      for (const lane of net.lanes) {
        const halted = Number((haltedByLane as any)[lane.id] ?? 0);
        if (!halted || lane.points.length < 2) continue;
        const t = Math.min(1, halted / maxHalted);
        ctx.strokeStyle = this.heatColor(t);
        ctx.beginPath();
        const p0 = toCanvas(lane.points[0]);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < lane.points.length; i++) {
          const pi = toCanvas(lane.points[i]);
          ctx.lineTo(pi.x, pi.y);
        }
        ctx.stroke();
      }
    }

    // Junctions (all) + labels (so you can see all 12 intersections)
    ctx.fillStyle = 'rgba(232, 238, 252, 0.75)';
    ctx.font = `${10 * dpr}px system-ui`;
    for (const j of net.junctions) {
      const p = toCanvas({ x: j.x, y: j.y });
      ctx.fillStyle = 'rgba(180, 190, 205, 0.7)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(232, 238, 252, 0.75)';
      ctx.fillText(j.id, p.x + 6 * dpr, p.y - 6 * dpr);
    }

    // Vehicles (real positions if provided by simulator)
    const vehicles = (snapshot as any)?.vehicles as Array<{ id: string; x: number; y: number; speed?: number; angle?: number }> | undefined;
    if (vehicles && vehicles.length > 0) {
      for (const v of vehicles) {
        const p = toCanvas({ x: v.x, y: v.y });
        ctx.fillStyle = '#ffd400';
        ctx.fillRect(p.x - 2.6 * dpr, p.y - 1.6 * dpr, 5.2 * dpr, 3.2 * dpr);
      }
    } else {
      // Cars (synthetic): distribute small rectangles along each lane proportional to halted
      const carW = 3.2 * dpr;
      const carH = 2.2 * dpr;
      ctx.fillStyle = '#ffd400';
      for (const lane of net.lanes) {
        const halted = Number((haltedByLane as any)[lane.id] ?? 0);
        if (!halted || lane.points.length < 2) continue;
        const count = Math.min(18, halted);
        const poly = lane.points.map(toCanvas);
        const segs = this.polySegments(poly);
        const total = segs.total;
        if (total <= 1e-6) continue;

        const seed = this.hash(`${lane.id}:${snapshot?.step ?? 0}`);
        for (let i = 0; i < count; i++) {
          const baseT = (i + 1) / (count + 1);
          const jitter = ((seed % 997) / 997 - 0.5) * 0.08;
          const d = Math.max(0, Math.min(1, baseT + jitter)) * total;
          const p = this.pointAtDistance(segs, d);
          const n = this.normalAtDistance(segs, d);
          const off = ((this.hash(`${seed}:${i}`) % 1000) / 1000 - 0.5) * (4 * dpr);
          ctx.fillRect(p.x + n.x * off - carW / 2, p.y + n.y * off - carH / 2, carW, carH);
        }
      }
    }

    // Traffic lights
    for (const j of net.lights) {
      const p = toCanvas({ x: j.x, y: j.y });
      const phase = byTls[j.id]?.phase;
      const color = this.phaseColor(phase);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.6 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();

      ctx.fillStyle = 'rgba(232, 238, 252, 0.75)';
      ctx.font = `${10 * dpr}px system-ui`;
      ctx.fillText(j.id, p.x + 6 * dpr, p.y - 6 * dpr);
    }

    // HUD
    ctx.fillStyle = 'rgba(232, 238, 252, 0.85)';
    ctx.font = `${12 * dpr}px system-ui`;
    ctx.fillText(`lanes=${net.lanes.length}  tls=${snapshot?.tlsId ?? '-'}  step=${snapshot?.step ?? '-'}`, 16 * dpr, 22 * dpr);
  }

  private async loadNet(): Promise<void> {
    if (this.net()) return;
    this.netError.set(null);

    try {
      const res = await fetch('/reseau_12_carrefours.net.xml', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} while fetching net.xml`);
      const xmlText = await res.text();
      const parsed = this.parseNet(xmlText);
      this.net.set(parsed);
    } catch (e) {
      this.netError.set(`Erreur chargement net.xml: ${String(e)}`);
    }
  }

  private parseNet(xmlText: string): NetData {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const laneEls = Array.from(doc.getElementsByTagName('lane')) as Element[];
    const junctionEls = Array.from(doc.getElementsByTagName('junction')) as Element[];

    const lanes: LaneShape[] = [];
    const lights: Array<{ id: string; x: number; y: number }> = [];
    const junctions: Array<{ id: string; x: number; y: number; type: string }> = [];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const el of laneEls) {
      const id = el.getAttribute('id') ?? '';
      const shape = el.getAttribute('shape') ?? '';
      if (!id || !shape) continue;
      // Ignore internal lanes (they start with ':') to keep it readable
      if (id.startsWith(':')) continue;

      const pts = this.parseShape(shape);
      if (pts.length < 2) continue;

      for (const p of pts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }

      lanes.push({ id, points: pts });
    }

    for (const el of junctionEls) {
      const type = el.getAttribute('type') ?? '';
      if (type !== 'traffic_light') continue;
      const id = el.getAttribute('id') ?? '';
      const x = Number(el.getAttribute('x'));
      const y = Number(el.getAttribute('y'));
      if (!id || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      lights.push({ id, x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    for (const el of junctionEls) {
      const id = el.getAttribute('id') ?? '';
      const type = el.getAttribute('type') ?? '';
      if (!id || id.startsWith(':')) continue;
      if (type === 'internal') continue;
      const x = Number(el.getAttribute('x'));
      const y = Number(el.getAttribute('y'));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      junctions.push({ id, x, y, type });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    if (!Number.isFinite(minX) || lanes.length === 0) {
      throw new Error('No usable lanes found in net.xml');
    }

    return { lanes, lights, junctions, bounds: { minX, minY, maxX, maxY } };
  }

  private parseShape(shape: string): Array<{ x: number; y: number }> {
    const parts = shape.trim().split(' ');
    const pts: Array<{ x: number; y: number }> = [];
    for (const part of parts) {
      const [xs, ys] = part.split(',');
      const x = Number(xs);
      const y = Number(ys);
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
    }
    return pts;
  }

  private maxValue(map: Record<string, unknown>): number {
    let m = 0;
    for (const v of Object.values(map)) {
      const n = Number(v);
      if (Number.isFinite(n)) m = Math.max(m, n);
    }
    return m;
  }

  private heatColor(t: number): string {
    // t in [0..1] => cyan -> yellow -> red
    const clamped = Math.max(0, Math.min(1, t));
    const a = 0.92;

    const lerp = (x: number, y: number, k: number) => x + (y - x) * k;
    const toRgb = (r: number, g: number, b: number) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;

    if (clamped < 0.5) {
      const k = clamped / 0.5;
      // cyan(0,220,255) -> yellow(255,220,0)
      return toRgb(lerp(0, 255, k), 220, lerp(255, 0, k));
    }

    const k = (clamped - 0.5) / 0.5;
    // yellow(255,220,0) -> red(255,40,40)
    return toRgb(255, lerp(220, 40, k), lerp(0, 40, k));
  }

  private phaseColor(phase: number | undefined): string {
    if (phase === undefined || phase === null) return 'rgba(180, 190, 205, 0.55)';
    const p = Math.abs(Math.trunc(phase)) % 3;
    if (p === 0) return 'rgba(0, 255, 170, 0.9)';
    if (p === 1) return 'rgba(255, 210, 80, 0.95)';
    return 'rgba(255, 80, 80, 0.95)';
  }

  private hash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private polySegments(points: Array<{ x: number; y: number }>): { total: number; segs: Array<{ a: any; b: any; len: number }> } {
    const segs: Array<{ a: { x: number; y: number }; b: { x: number; y: number }; len: number }> = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) {
        segs.push({ a, b, len });
        total += len;
      }
    }
    return { total, segs };
  }

  private pointAtDistance(poly: { total: number; segs: Array<{ a: any; b: any; len: number }> }, d: number): { x: number; y: number } {
    let rem = Math.max(0, Math.min(poly.total, d));
    for (const s of poly.segs) {
      if (rem <= s.len) {
        const t = s.len === 0 ? 0 : rem / s.len;
        return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
      }
      rem -= s.len;
    }
    const last = poly.segs[poly.segs.length - 1];
    return last ? { x: last.b.x, y: last.b.y } : { x: 0, y: 0 };
  }

  private normalAtDistance(poly: { total: number; segs: Array<{ a: any; b: any; len: number }> }, d: number): { x: number; y: number } {
    let rem = Math.max(0, Math.min(poly.total, d));
    for (const s of poly.segs) {
      if (rem <= s.len) {
        const dx = s.b.x - s.a.x;
        const dy = s.b.y - s.a.y;
        const len = Math.hypot(dx, dy) || 1;
        // perpendicular unit vector
        return { x: -dy / len, y: dx / len };
      }
      rem -= s.len;
    }
    return { x: 0, y: -1 };
  }
}
