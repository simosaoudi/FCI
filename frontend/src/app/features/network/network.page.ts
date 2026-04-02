import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, computed, signal } from '@angular/core';
import { SimulationService } from '../../core/services/simulation.service';
import { TrafficWsService } from '../../core/services/traffic-ws.service';

type LaneShape = {
  id: string;
  points: Array<{ x: number; y: number }>;
};

type NetData = {
  lanes: LaneShape[];
  lights: Array<{ id: string; x: number; y: number; incLanes: string[] }>;
  junctions: Array<{ id: string; x: number; y: number; type: string }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  laneById: Record<string, LaneShape>;
};

@Component({
  selector: 'app-network',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './network.page.html',
  styleUrl: './network.page.scss'
})
export class NetworkPage implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) private canvasRef!: ElementRef<HTMLCanvasElement>;
  private raf: number | null = null;

  protected readonly showVehicles = signal(true);
  private readonly maxVehiclesToDraw = 600;
  private readonly vehicleMotion = new Map<string, { lastSpeed: number; lastStartedStep: number }>();

  private readonly net = signal<NetData | null>(null);
  protected readonly netLoaded = computed(() => !!this.net());
  protected readonly netError = signal<string | null>(null);

  protected readonly msg = computed(() => this.ws.lastMessage());
  private readonly snapshotsByTlsId = computed(() => this.ws.snapshotsByTlsId());
  
  // Counters
  private readonly trafficLightCount = signal(0);

  private readonly vehiclesSnapshot = computed(() => {
    const m = this.ws.lastMessage() as any;
    const direct = m?.vehicles;
    if (Array.isArray(direct) && direct.length > 0) return direct;

    const byTls = this.ws.snapshotsByTlsId();
    for (const s of Object.values(byTls)) {
      const v = (s as any)?.vehicles;
      if (Array.isArray(v) && v.length > 0) return v;
    }
    return undefined;
  });

  private readonly incidents = computed(() => this.simulation.incidents());

  constructor(
    private readonly ws: TrafficWsService,
    private readonly simulation: SimulationService
  ) {}

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

    this.destroy = () => { window.removeEventListener('resize', resize); };
    void this.loadNet();
  }

  // ─── State helpers ────────────────────────────────────────────────────────

  private armStateFromSignalChar(ch: unknown): 'R' | 'Y' | 'G' | null {
    const s = String(ch ?? '');
    if (!s) return null;
    const c = s[0];
    if (c === 'G' || c === 'g') return 'G';
    if (c === 'y' || c === 'Y') return 'Y';
    if (c === 'r' || c === 'R') return 'R';
    return null;
  }

  private armStateFromHalted(halted: number | undefined): 'R' | 'Y' | 'G' {
    const h = Number(halted ?? 0);
    if (!Number.isFinite(h) || h <= 0) return 'G';
    if (h >= 3) return 'R';
    return 'Y';
  }

  private phaseState(phase: number | undefined): 'R' | 'Y' | 'G' {
    if (phase === undefined || phase === null) return 'Y';
    const p = Math.abs(Math.trunc(phase)) % 4;
    return p % 2 === 0 ? 'G' : 'Y';
  }

  private vehicleStateColor(speed: number, stepsSinceStart: number): string {
    const s = Number.isFinite(speed) ? speed : 0;
    if (s <= 0.1) return '#ff3c3c';
    if (stepsSinceStart >= 0 && stepsSinceStart <= 12) return '#3ca8ff';
    return '#00f09a';
  }

  // ─── Geometry helpers ──────────────────────────────────────────────────────

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number
  ): void {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  private polySegments(
    points: Array<{ x: number; y: number }>
  ): { total: number; segs: Array<{ a: { x: number; y: number }; b: { x: number; y: number }; len: number }> } {
    const segs: Array<{ a: { x: number; y: number }; b: { x: number; y: number }; len: number }> = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 1e-6) { segs.push({ a, b, len }); total += len; }
    }
    return { total, segs };
  }

  private pointAtDistance(
    poly: { total: number; segs: Array<{ a: any; b: any; len: number }> },
    d: number
  ): { x: number; y: number } {
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

  private normalAtDistance(
    poly: { total: number; segs: Array<{ a: any; b: any; len: number }> },
    d: number
  ): { x: number; y: number } {
    let rem = Math.max(0, Math.min(poly.total, d));
    for (const s of poly.segs) {
      if (rem <= s.len) {
        const dx = s.b.x - s.a.x;
        const dy = s.b.y - s.a.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: -dy / len, y: dx / len };
      }
      rem -= s.len;
    }
    return { x: 0, y: -1 };
  }

  private polyPointAtRatio(
    pts: Array<{ x: number; y: number }>,
    ratio: number
  ): { p: { x: number; y: number }; angleRad: number } {
    const segs = this.polySegments(pts);
    const total = segs.total;
    if (!Number.isFinite(total) || total <= 1e-6) {
      const a = pts[0];
      const b = pts[pts.length - 1];
      return { p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angleRad: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    const d = Math.max(0, Math.min(1, ratio)) * total;
    const p = this.pointAtDistance(segs, d);
    const n = this.normalAtDistance(segs, d);
    return { p: { x: p.x, y: p.y }, angleRad: Math.atan2(-n.x, n.y) };
  }

  private hash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private findNearbyLane(x: number, y: number, net: NetData): LaneShape | null {
    let closest: LaneShape | null = null;
    let minDist = Infinity;
    for (const lane of net.lanes) {
      for (const pt of lane.points) {
        const d = Math.hypot(pt.x - x, pt.y - y);
        if (d < minDist) { minDist = d; closest = lane; }
      }
    }
    return minDist < 20 ? closest : null;
  }

  private findClosestPointIndex(x: number, y: number, points: Array<{ x: number; y: number }>): number {
    let minDist = Infinity;
    let idx = 0;
    for (let i = 0; i < points.length; i++) {
      const d = Math.hypot(points[i].x - x, points[i].y - y);
      if (d < minDist) { minDist = d; idx = i; }
    }
    return idx;
  }

  private incomingArmAnchor(
    lanePoints: Array<{ x: number; y: number }>,
    _net: NetData,
    toCanvas: (p: { x: number; y: number }) => { x: number; y: number },
    dpr: number,
    preferOutward: 'up' | 'down' | 'left' | 'right' | null
  ): { x: number; y: number } | null {
    if (lanePoints.length < 2) return null;
    const a = lanePoints[lanePoints.length - 2];
    const b = lanePoints[lanePoints.length - 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;

    const back = 8;
    const t = Math.max(0, Math.min(1, 1 - back / len));
    const px = a.x + dx * t;
    const py = a.y + dy * t;

    const idxA = Math.max(0, lanePoints.length - 4);
    const pa = toCanvas(lanePoints[idxA]);
    const pb = toCanvas(b);
    const dirX = pb.x - pa.x;
    const dirY = pb.y - pa.y;
    const lenC = Math.hypot(dirX, dirY);
    if (lenC < 1e-6) return null;

    const nx = -dirY / lenC;
    const ny = dirX / lenC;
    const offPx = 16 * dpr;
    const p = toCanvas({ x: px, y: py });
    const c1 = { x: p.x + nx * offPx, y: p.y + ny * offPx };
    const c2 = { x: p.x - nx * offPx, y: p.y - ny * offPx };

    if (preferOutward === 'up')    return c1.y <= c2.y ? c1 : c2;
    if (preferOutward === 'down')  return c1.y >= c2.y ? c1 : c2;
    if (preferOutward === 'left')  return c1.x <= c2.x ? c1 : c2;
    if (preferOutward === 'right') return c1.x >= c2.x ? c1 : c2;
    return c1;
  }

  // ─── Draw helpers ──────────────────────────────────────────────────────────

  private drawTrafficLight(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    phase: number | undefined,
    dpr: number,
    scale = 1,
    stateOverride?: 'R' | 'Y' | 'G'
  ): void {
    const state = stateOverride ?? this.phaseState(phase);
    const w  = 13 * dpr * scale;
    const h  = 32 * dpr * scale;
    const r  = 3 * dpr * scale;
    const lampR = 4.2 * dpr * scale;
    const gap   = 2.0 * dpr * scale;
    const topY  = -h / 2 + 4.5 * dpr * scale;
    const ys = [topY, topY + (lampR * 2 + gap), topY + 2 * (lampR * 2 + gap)];

    ctx.save();
    ctx.translate(x, y);

    // Pole
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(90, 100, 120, 0.9)';
    ctx.lineWidth = 2.0 * dpr * scale;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(0, h / 2 + 10 * dpr * scale);
    ctx.stroke();

    // Housing shadow glow
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8 * dpr * scale;

    // Housing body
    ctx.fillStyle = '#0a0c14';
    this.roundRect(ctx, -w / 2, -h / 2, w, h, r);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Housing border
    ctx.strokeStyle = 'rgba(140, 155, 190, 0.3)';
    ctx.lineWidth = 0.8 * dpr;
    this.roundRect(ctx, -w / 2, -h / 2, w, h, r);
    ctx.stroke();

    // Lamps
    const lamp = (yy: number, on: boolean, color: string, glowColor: string) => {
      if (on) {
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 12 * dpr * scale;
      }
      ctx.beginPath();
      ctx.arc(0, yy, lampR, 0, Math.PI * 2);
      ctx.fillStyle = on ? color : 'rgba(40, 45, 62, 0.75)';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 0.6 * dpr * scale;
      ctx.stroke();
    };

    lamp(ys[0], state === 'R', '#ff3030', '#ff000099');
    lamp(ys[1], state === 'Y', '#ffd240', '#ffaa0099');
    lamp(ys[2], state === 'G', '#00ee90', '#00ff8099');

    ctx.restore();
  }

  private drawStoppedCar(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, angleRad: number, dpr: number
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angleRad);
    const carL = 14 * dpr, carW = 7 * dpr, r = 1.8 * dpr;
    ctx.fillStyle = '#ff4646';
    this.roundRect(ctx, -carL / 2, -carW / 2, carL, carW, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.0 * dpr;
    ctx.stroke();
    ctx.restore();
  }

  private drawAccidentCars(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, angleRad: number | undefined, dpr: number
  ): void {
    const ang = Number.isFinite(angleRad as number) ? (angleRad as number) : 0;
    const off = 6.5 * dpr;
    const nx = Math.cos(ang + Math.PI / 2);
    const ny = Math.sin(ang + Math.PI / 2);
    this.drawStoppedCar(ctx, x + nx * off, y + ny * off, ang + 0.35, dpr);
    this.drawStoppedCar(ctx, x - nx * off, y - ny * off, ang - 0.35 + Math.PI, dpr);
  }

  private drawIncidentMarker(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, type: string, dpr: number
  ): void {
    ctx.save();
    ctx.translate(x, y);
    const r = 9 * dpr;
    ctx.fillStyle = type === 'TRAVAUX' ? 'rgba(255, 70, 70, 0.95)' : 'rgba(255, 120, 40, 0.95)';
    ctx.strokeStyle = 'rgba(12, 14, 18, 0.65)';
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(12, 14, 18, 0.85)';
    ctx.font = `bold ${10 * dpr}px system-ui`;
    const label = type === 'TRAVAUX' ? 'T' : '!';
    const m = ctx.measureText(label);
    ctx.fillText(label, -m.width / 2, 3.5 * dpr);
    ctx.restore();
  }

  private drawBlockedLane(
    ctx: CanvasRenderingContext2D,
    pts: Array<{ x: number; y: number }>,
    toCanvas: (p: { x: number; y: number }) => { x: number; y: number },
    dpr: number
  ): void {
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(7.5 * dpr, 5);
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.85)';
    ctx.beginPath();
    const p0 = toCanvas(pts[0]);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < pts.length; i++) {
      const pi = toCanvas(pts[i]);
      ctx.lineTo(pi.x, pi.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawIncidentOverlay(
    ctx: CanvasRenderingContext2D,
    net: NetData,
    toCanvas: (p: { x: number; y: number }) => { x: number; y: number },
    dpr: number
  ): void {
    const list = this.incidents();
    if (!list || list.length === 0) return;
    for (const inc of list) {
      const type = String((inc as any)?.incidentType ?? 'ACCIDENT').toUpperCase();
      const laneId = (inc as any)?.laneId as string | undefined;
      const junctionId = (inc as any)?.junctionId as string | undefined;
      if (laneId) {
        const lane = net.laneById[laneId];
        if (!lane || lane.points.length < 2) continue;
        const mid = this.polyPointAtRatio(lane.points, 0.5);
        const p = toCanvas(mid.p);
        if (type === 'BREAKDOWN') this.drawStoppedCar(ctx, p.x, p.y, mid.angleRad, dpr);
        else if (type === 'ACCIDENT') this.drawAccidentCars(ctx, p.x, p.y, mid.angleRad, dpr);
        else if (type === 'TRAVAUX') {
          this.drawBlockedLane(ctx, lane.points, toCanvas, dpr);
          this.drawIncidentMarker(ctx, p.x, p.y, type, dpr);
        } else this.drawIncidentMarker(ctx, p.x, p.y, type, dpr);
        continue;
      }
      if (junctionId) {
        const j = net.junctions.find((x) => x.id === junctionId);
        if (!j) continue;
        const p = toCanvas({ x: j.x, y: j.y });
        if (type === 'ACCIDENT') this.drawAccidentCars(ctx, p.x, p.y, undefined, dpr);
        else this.drawIncidentMarker(ctx, p.x, p.y, type, dpr);
      }
    }
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  private destroy: (() => void) | null = null;

  ngOnDestroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.destroy?.();
  }

  // ─── Main draw ─────────────────────────────────────────────────────────────

  private draw(): void {
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#0b0e17';
    ctx.fillRect(0, 0, W, H);

    const net = this.net();
    if (!net) {
      ctx.fillStyle = 'rgba(140, 160, 200, 0.7)';
      ctx.font = `${13 * dpr}px system-ui`;
      ctx.fillText(this.netError() ?? 'Chargement du réseau SUMO…', 20 * dpr, 28 * dpr);
      return;
    }

    const snapshot = this.msg();
    const byTls = this.snapshotsByTlsId();

    // Merge halted counts across all TLS
    const haltedByLane: Record<string, number> = {};
    for (const s of Object.values(byTls)) {
      const lanes = (s as any)?.lanes as Record<string, number> | undefined;
      if (!lanes) continue;
      for (const [k, v] of Object.entries(lanes)) {
        const n = Number(v);
        haltedByLane[k] = (haltedByLane[k] ?? 0) + (Number.isFinite(n) ? n : 0);
      }
    }

    // ── Uniform scale, centered projection ──────────────────────────────────
    //const pad = 55 * dpr;
    const padH = 0 * dpr;    // Horizontal padding (left/right)
    const padV = 15 * dpr;   // Vertical padding (top/bottom)
    const spanX = Math.max(1e-6, net.bounds.maxX - net.bounds.minX);
    const spanY = Math.max(1e-6, net.bounds.maxY - net.bounds.minY);
    const scX = (W - padH * 2) / spanX;  // Horizontal scale (stretched)
    const scY = (H - padV * 2) / spanY;  // Vertical scale (normal)
    const cx = (net.bounds.minX + net.bounds.maxX) / 2;
    const cy = (net.bounds.minY + net.bounds.maxY) / 2;

    const toCanvas = (p: { x: number; y: number }): { x: number; y: number } => ({
      x: W / 2 + (p.x - cx) * scX,  // Use scX for horizontal stretching
      y: H / 2 - (p.y - cy) * scY   // Use scY for vertical (normal)
    });

    // Road width: SUMO standard lane = 3.2m; use that × scale, min 12px
    const laneW = Math.max(3.2 * scY, 14 * dpr);
    // Road drawing line width covers one lane (two opposing directions overlap)
    const roadLineW = laneW * 1.7;

    // ── City blocks (buildings between intersections) ────────────────────────
    const jxs = Array.from(new Set(net.junctions.map((j) => j.x))).sort((a, b) => a - b);
    const jys = Array.from(new Set(net.junctions.map((j) => j.y))).sort((a, b) => a - b);
    const blockMargin = roadLineW * 1.3 + 6 * dpr;

    if (jxs.length >= 2 && jys.length >= 2) {
      for (let xi = 0; xi < jxs.length - 1; xi++) {
        for (let yi = 0; yi < jys.length - 1; yi++) {
          const p0 = toCanvas({ x: jxs[xi],     y: jys[yi]     });
          const p1 = toCanvas({ x: jxs[xi + 1], y: jys[yi + 1] });
          const left = Math.min(p0.x, p1.x) + blockMargin;
          const top  = Math.min(p0.y, p1.y) + blockMargin;
          const bw   = Math.abs(p1.x - p0.x) - blockMargin * 2;
          const bh   = Math.abs(p1.y - p0.y) - blockMargin * 2;
          if (bw < 8 || bh < 8) continue;

          // Main building block
          ctx.fillStyle = '#111826';
          ctx.strokeStyle = 'rgba(40, 70, 140, 0.3)';
          ctx.lineWidth = 1 * dpr;
          ctx.beginPath();
          const br = 5 * dpr;
          ctx.moveTo(left + br, top);
          ctx.lineTo(left + bw - br, top);
          ctx.quadraticCurveTo(left + bw, top, left + bw, top + br);
          ctx.lineTo(left + bw, top + bh - br);
          ctx.quadraticCurveTo(left + bw, top + bh, left + bw - br, top + bh);
          ctx.lineTo(left + br, top + bh);
          ctx.quadraticCurveTo(left, top + bh, left, top + bh - br);
          ctx.lineTo(left, top + br);
          ctx.quadraticCurveTo(left, top, left + br, top);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Subtle window grid lines
          ctx.strokeStyle = 'rgba(50, 80, 160, 0.12)';
          ctx.lineWidth = 0.6 * dpr;
          const cols = 4, rows = 4;
          for (let c = 1; c < cols; c++) {
            const tx = left + (bw / cols) * c;
            ctx.beginPath(); ctx.moveTo(tx, top); ctx.lineTo(tx, top + bh); ctx.stroke();
          }
          for (let rr = 1; rr < rows; rr++) {
            const ty = top + (bh / rows) * rr;
            ctx.beginPath(); ctx.moveTo(left, ty); ctx.lineTo(left + bw, ty); ctx.stroke();
          }
        }
      }
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // ── Road shadow (bottom layer) ───────────────────────────────────────────
    ctx.lineWidth = roadLineW + 10 * dpr;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
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

    // ── Road surface (asphalt) ───────────────────────────────────────────────
    ctx.lineWidth = roadLineW;
    ctx.strokeStyle = '#1e2231';
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

    // ── Road edge highlight (subtle lighter border on road sides) ────────────
    ctx.lineWidth = roadLineW - 1 * dpr;
    ctx.strokeStyle = 'rgba(60, 70, 100, 0.25)';
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

    // ── Lane center dashes (white, subtle) ────────────────────────────────────
    ctx.setLineDash([7 * dpr, 11 * dpr]);
    ctx.lineWidth = 1.4 * dpr;
    ctx.strokeStyle = 'rgba(200, 215, 255, 0.15)';
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
    ctx.setLineDash([]);

    // ── Junction fill circles (smooth the road intersections) ────────────────
    for (const j of net.junctions) {
      if (j.id.startsWith(':')) continue;
      const p = toCanvas({ x: j.x, y: j.y });
      ctx.beginPath();
      ctx.arc(p.x, p.y, roadLineW * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = '#1e2231';
      ctx.fill();
    }

    // ── Curb marks at junctions (traffic-light junctions highlighted) ─────────
    for (const j of net.junctions) {
      if (j.type !== 'traffic_light') continue;
      const p = toCanvas({ x: j.x, y: j.y });
      ctx.beginPath();
      ctx.arc(p.x, p.y, roadLineW * 0.92, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(70, 120, 220, 0.4)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
    }

    // ── Direction arrows on lane centers ─────────────────────────────────────
    ctx.fillStyle = 'rgba(180, 200, 255, 0.14)';
    for (const lane of net.lanes) {
      if (lane.points.length < 2) continue;
      // Draw arrow at lane midpoint
      const mid = Math.floor(lane.points.length / 2);
      const ia = Math.max(0, mid - 1);
      const ib = Math.min(lane.points.length - 1, mid + 1);
      const pa = toCanvas(lane.points[ia]);
      const pb = toCanvas(lane.points[ib]);
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const ux = dx / len, uy = dy / len;
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      const as = 5 * dpr;
      ctx.beginPath();
      ctx.moveTo(mx + ux * as, my + uy * as);
      ctx.lineTo(mx - ux * as - uy * (as * 0.55), my - uy * as + ux * (as * 0.55));
      ctx.lineTo(mx - ux * as + uy * (as * 0.55), my - uy * as - ux * (as * 0.55));
      ctx.closePath();
      ctx.fill();
    }

    // ── Junction labels ───────────────────────────────────────────────────────
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.max(8, 9 * dpr)}px system-ui`;
    for (const j of net.junctions) {
      if (j.id.startsWith(':')) continue;
      const p = toCanvas({ x: j.x, y: j.y });
      const tw = ctx.measureText(j.id).width + 7 * dpr;
      const th = 12 * dpr;
      // Label pill background
      ctx.fillStyle = 'rgba(8, 12, 26, 0.82)';
      this.roundRect(ctx, p.x - tw / 2, p.y - th / 2, tw, th, 3 * dpr);
      ctx.fill();
      // Label text
      ctx.fillStyle = j.type === 'traffic_light'
        ? 'rgba(140, 190, 255, 0.95)'
        : 'rgba(160, 175, 210, 0.80)';
      ctx.fillText(j.id, p.x, p.y);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';

    // ── Vehicles ──────────────────────────────────────────────────────────────
    const vehicles = this.vehiclesSnapshot() as
      | Array<{ id: string; x: number; y: number; speed?: number; angle?: number }>
      | undefined;

    if (this.showVehicles() && vehicles && vehicles.length > 0) {
      const stride = Math.max(1, Math.floor(vehicles.length / this.maxVehiclesToDraw));
      for (let i = 0; i < vehicles.length; i += stride) {
        const v = vehicles[i];
        if (!v) continue;

        // Lateral offset within lane
        const laneHash = this.hash(v.id);
        const side = (laneHash % 2) === 0 ? -1 : 1;
        const lateralPx = side * 3.2 * dpr;

        const nearbyLane = this.findNearbyLane(v.x, v.y, net);
        let nnx = 0, nny = -1;
        if (nearbyLane && nearbyLane.points.length >= 2) {
          const idx = this.findClosestPointIndex(v.x, v.y, nearbyLane.points);
          if (idx < nearbyLane.points.length - 1) {
            const p1 = nearbyLane.points[idx], p2 = nearbyLane.points[idx + 1];
            const dx = p2.x - p1.x, dy = p2.y - p1.y;
            const l = Math.hypot(dx, dy) || 1;
            nnx = -dy / l; nny = dx / l;
          }
        }

        const base = toCanvas({ x: v.x, y: v.y });
        const p = { x: base.x + nnx * lateralPx, y: base.y + nny * lateralPx };

        const sp = Number(v.speed ?? 0);
        const stepNow = Number((snapshot as any)?.step ?? 0);
        const prev = this.vehicleMotion.get(v.id);
        const prevSpeed = prev?.lastSpeed ?? 0;
        const justStarted = prevSpeed <= 0.1 && sp > 0.3;
        const lastStartedStep = justStarted ? stepNow : (prev?.lastStartedStep ?? -999999);
        this.vehicleMotion.set(v.id, { lastSpeed: sp, lastStartedStep });

        const angleDeg = Number(v.angle);
        const rad = Number.isFinite(angleDeg) ? ((90 - angleDeg) * Math.PI) / 180 : 0;
        const color = this.vehicleStateColor(sp, stepNow - lastStartedStep);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(rad);

        const cL = 12 * dpr, cW = 5.5 * dpr, cr = 1.6 * dpr;
        const x0 = -cL / 2, y0 = -cW / 2;

        // Glow halo for moving vehicles
        if (sp > 0.5) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 6 * dpr;
        }
        ctx.fillStyle = color;
        this.roundRect(ctx, x0, y0, cL, cW, cr);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Car outline
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 0.7 * dpr;
        this.roundRect(ctx, x0, y0, cL, cW, cr);
        ctx.stroke();

        // Windshield
        ctx.fillStyle = 'rgba(5, 10, 25, 0.65)';
        this.roundRect(ctx, x0 + cL * 0.14, y0 + cW * 0.18, cL * 0.3, cW * 0.64, 1.0 * dpr);
        ctx.fill();

        // Headlights
        ctx.fillStyle = 'rgba(255, 248, 190, 0.8)';
        const hlOff = cW * 0.24;
        ctx.beginPath();
        ctx.arc(x0 + cL * 0.88, y0 + hlOff,      1.2 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x0 + cL * 0.88, -y0 - hlOff, 1.2 * dpr, 0, Math.PI * 2);
        ctx.fill();

        // Rear lights
        ctx.fillStyle = sp <= 0.1 ? 'rgba(255, 50, 50, 0.9)' : 'rgba(180, 20, 20, 0.7)';
        ctx.beginPath();
        ctx.arc(x0 + cL * 0.1, y0 + hlOff,      1.0 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x0 + cL * 0.1, -y0 - hlOff, 1.0 * dpr, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }

    } else {
      // Synthetic cars from halted counts
      for (const lane of net.lanes) {
        const halted = Number((haltedByLane as any)[lane.id] ?? 0);
        if (!halted || lane.points.length < 2) continue;
        const count = Math.min(18, halted);
        const poly = lane.points.map(toCanvas);
        const segs = this.polySegments(poly);
        if (segs.total <= 1e-6) continue;
        const seed = this.hash(`${lane.id}:${snapshot?.step ?? 0}`);
        for (let i = 0; i < count; i++) {
          const baseT = (i + 1) / (count + 1);
          const jitter = ((seed % 997) / 997 - 0.5) * 0.08;
          const d = Math.max(0, Math.min(1, baseT + jitter)) * segs.total;
          const pt = this.pointAtDistance(segs, d);
          const n  = this.normalAtDistance(segs, d);
          const side = (this.hash(`${seed}:${i}:pos`) % 2) === 0 ? -1 : 1;
          const off = side * 4.0 * dpr + ((this.hash(`${seed}:${i}:v`) % 1000) / 1000 - 0.5) * dpr;
          ctx.fillStyle = '#ffd440';
          ctx.fillRect(pt.x + n.x * off - 3 * dpr, pt.y + n.y * off - 1.5 * dpr, 6 * dpr, 3 * dpr);
        }
      }
    }

    // ── Traffic lights ────────────────────────────────────────────────────────
    let panelCount = 0;

    for (const j of net.lights) {
      const tlsSnap = byTls[j.id];
      const phase = tlsSnap?.phase;
      const laneSignalStates = (tlsSnap as any)?.laneSignalStates as Record<string, string> | undefined;
      const haltedLocal = tlsSnap?.lanes ?? {};

      const eps = 1e-3;
      const preferOutward: 'up' | 'down' | 'left' | 'right' | null =
        Math.abs(j.y - net.bounds.maxY) < eps ? 'up'    :
        Math.abs(j.y - net.bounds.minY) < eps ? 'down'  :
        Math.abs(j.x - net.bounds.minX) < eps ? 'left'  :
        Math.abs(j.x - net.bounds.maxX) < eps ? 'right' : null;

      // Group incoming lanes by edge
      const lanesByEdge: Record<string, string[]> = {};
      for (const laneId of j.incLanes) {
        const edgeId = laneId.replace(/_\d+$/, '');
        (lanesByEdge[edgeId] ??= []).push(laneId);
      }

      for (const laneIds of Object.values(lanesByEdge)) {
        laneIds.sort();
        let lane: LaneShape | undefined;
        let laneId: string | null = null;
        for (const candidate of laneIds) {
          const l = net.laneById[candidate];
          if (l && l.points.length >= 2) { lane = l; laneId = candidate; break; }
        }
        if (!lane || !laneId) continue;

        const arm = this.incomingArmAnchor(lane.points, net, toCanvas, dpr, preferOutward);
        if (!arm) continue;

        // Determine real state from signal chars or halted count
        const signalCh = laneSignalStates?.[laneId];
        const fromSignal = this.armStateFromSignalChar(signalCh);
        const halted = Number((haltedLocal as any)[laneId] ?? 0);
        const armState = fromSignal ?? this.armStateFromHalted(halted);

        this.drawTrafficLight(ctx, arm.x, arm.y, phase, dpr, 0.85, armState);
        panelCount++;
      }
    }

    // ── Incident overlay ──────────────────────────────────────────────────────
    this.drawIncidentOverlay(ctx, net, toCanvas, dpr);

    // Update traffic light count signal
    this.trafficLightCount.set(panelCount);
  }

  // ─── Computed accessors ────────────────────────────────────────────────────

  protected vehiclesCount(): number {
    const v = this.vehiclesSnapshot() as Array<unknown> | undefined;
    return Array.isArray(v) ? v.length : 0;
  }

  protected hasTlState(): boolean {
    const s = (this.msg() as any)?.tlState;
    return typeof s === 'string' && s.length > 0;
  }

  protected laneSignalCount(): number {
    const m = (this.msg() as any)?.laneSignalStates as Record<string, unknown> | undefined;
    return m && typeof m === 'object' ? Object.keys(m).length : 0;
  }

  protected lanesCount(): number {
    const n = this.net();
    return n ? n.lanes.length : 0;
  }

  protected trafficLightsCount(): number {
    return this.trafficLightCount();
  }

  // ─── Net loading & parsing ─────────────────────────────────────────────────

  private async loadNet(): Promise<void> {
    if (this.net()) return;
    this.netError.set(null);
    try {
      const res = await fetch('/reseau_12_carrefours.net.xml', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.net.set(this.parseNet(await res.text()));
    } catch (e) {
      this.netError.set(`Erreur chargement réseau: ${String(e)}`);
    }
  }

  private parseNet(xmlText: string): NetData {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const laneEls = Array.from(doc.getElementsByTagName('lane')) as Element[];
    const junctionEls = Array.from(doc.getElementsByTagName('junction')) as Element[];

    const lanes: LaneShape[] = [];
    const laneById: Record<string, LaneShape> = {};
    const lights: Array<{ id: string; x: number; y: number; incLanes: string[] }> = [];
    const junctions: Array<{ id: string; x: number; y: number; type: string }> = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const el of laneEls) {
      const id = el.getAttribute('id') ?? '';
      const shape = el.getAttribute('shape') ?? '';
      if (!id || !shape || id.startsWith(':')) continue;
      const pts = this.parseShape(shape);
      if (pts.length < 2) continue;
      for (const p of pts) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      const lane: LaneShape = { id, points: pts };
      lanes.push(lane);
      laneById[id] = lane;
    }

    // Traffic-light junctions + corner priority junctions (for light rendering)
    const extraCornerIds = new Set(['A0', 'A2', 'D0', 'D2']);
    for (const el of junctionEls) {
      const type = el.getAttribute('type') ?? '';
      const id   = el.getAttribute('id')   ?? '';
      if (!id || id.startsWith(':')) continue;
      if (type !== 'traffic_light' && !extraCornerIds.has(id)) continue;
      const x = Number(el.getAttribute('x'));
      const y = Number(el.getAttribute('y'));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const incLanes = (el.getAttribute('incLanes') ?? '')
        .split(' ').map((s) => s.trim()).filter(Boolean);
      lights.push({ id, x, y, incLanes });
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }

    // All non-internal junctions for labels
    for (const el of junctionEls) {
      const id   = el.getAttribute('id')   ?? '';
      const type = el.getAttribute('type') ?? '';
      if (!id || id.startsWith(':') || type === 'internal') continue;
      const x = Number(el.getAttribute('x'));
      const y = Number(el.getAttribute('y'));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      junctions.push({ id, x, y, type });
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }

    if (!Number.isFinite(minX) || lanes.length === 0) {
      throw new Error('Aucune voie valide trouvée dans net.xml');
    }

    return { lanes, laneById, lights, junctions, bounds: { minX, minY, maxX, maxY } };
  }

  private parseShape(shape: string): Array<{ x: number; y: number }> {
    const pts: Array<{ x: number; y: number }> = [];
    for (const part of shape.trim().split(' ')) {
      const [xs, ys] = part.split(',');
      const x = Number(xs), y = Number(ys);
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
    }
    return pts;
  }
}
