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

    this.destroy = () => {
      window.removeEventListener('resize', resize);
    };

    void this.loadNet();
  }

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

  private vehicleStateColor(speed: number, stepsSinceStart: number): string {
    // stopped -> red, moving -> green, just started -> blue
    const s = Number.isFinite(speed) ? speed : 0;
    if (s <= 0.1) return 'rgba(255, 70, 70, 0.96)';
    if (stepsSinceStart >= 0 && stepsSinceStart <= 12) return 'rgba(80, 170, 255, 0.96)';
    return 'rgba(0, 255, 170, 0.92)';
  }

  private incomingArmAnchor(
    lanePoints: Array<{ x: number; y: number }>,
    net: NetData,
    toCanvas: (p: { x: number; y: number }) => { x: number; y: number },
    dpr: number,
    preferOutward: 'up' | 'down' | 'left' | 'right' | null
  ): { x: number; y: number } | null {
    if (lanePoints.length < 2) return null;

    // For incoming lanes, the last point is usually closest to the junction.
    const a = lanePoints[lanePoints.length - 2];
    const b = lanePoints[lanePoints.length - 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;

    // place the light slightly before the junction along the lane direction (towards b)
    const back = 10; // SUMO units
    const t = Math.max(0, Math.min(1, 1 - back / len));
    const px = a.x + dx * t;
    const py = a.y + dy * t;

    // Offset in CANVAS pixels so it stays on the right side visually even with thick road strokes.
    // Use a longer approach direction (not just the last tiny segment) to avoid misplacement
    // on curved lane geometries near junctions.
    const idxA = Math.max(0, lanePoints.length - 4);
    const aDir = lanePoints[idxA];
    const pa = toCanvas(aDir);
    const pb = toCanvas(b);
    const dirX = pb.x - pa.x;
    const dirY = pb.y - pa.y;
    const lenC = Math.hypot(dirX, dirY);
    if (lenC < 1e-6) return null;

    // Right normal for direction a -> b in canvas coordinates (y-down)
    // With y-down, the right-hand side is the LEFT normal in usual math coordinates.
    const nx = -dirY / lenC;
    const ny = dirX / lenC;
    const offPx = 20 * dpr;

    const p = toCanvas({ x: px, y: py });

    const cand1 = { x: p.x + nx * offPx, y: p.y + ny * offPx };
    const cand2 = { x: p.x - nx * offPx, y: p.y - ny * offPx };

    if (preferOutward === 'up') return cand1.y <= cand2.y ? cand1 : cand2;
    if (preferOutward === 'down') return cand1.y >= cand2.y ? cand1 : cand2;
    if (preferOutward === 'left') return cand1.x <= cand2.x ? cand1 : cand2;
    if (preferOutward === 'right') return cand1.x >= cand2.x ? cand1 : cand2;

    return cand1;
  }

  private drawTrafficLight(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    phase: number | undefined,
    dpr: number,
    scale = 1,
    stateOverride?: 'R' | 'Y' | 'G'
  ): void {
    const state = stateOverride ?? this.phaseState(phase);
    const w = 9.5 * dpr * scale;
    const h = 22 * dpr * scale;
    const r = 2.2 * dpr * scale;

    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = 'rgba(12, 14, 20, 0.92)';
    this.roundRect(ctx, -w / 2, -h / 2, w, h, r);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();

    const lampR = 2.6 * dpr * scale;
    const gap = 1.4 * dpr * scale;
    const topY = -h / 2 + 5.2 * dpr * scale;
    const ys = [topY, topY + (lampR * 2 + gap), topY + 2 * (lampR * 2 + gap)];

    const lamp = (yy: number, on: boolean, color: string) => {
      ctx.beginPath();
      ctx.arc(0, yy, lampR, 0, Math.PI * 2);
      ctx.fillStyle = on ? color : 'rgba(70, 80, 95, 0.35)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 0.8 * dpr * scale;
      ctx.stroke();
    };

    lamp(ys[0], state === 'R', 'rgba(255, 70, 70, 0.98)');
    lamp(ys[1], state === 'Y', 'rgba(255, 210, 80, 0.98)');
    lamp(ys[2], state === 'G', 'rgba(0, 255, 170, 0.98)');

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

  private phaseState(phase: number | undefined): 'R' | 'Y' | 'G' {
    // Our network uses SUMO static programs with 4 phases (G, y, G, y).
    // We don't have per-arm state strings here, only the phase index.
    // Mapping: even => green, odd => yellow. Unknown => red.
    if (phase === undefined || phase === null) return 'Y';
    const p = Math.abs(Math.trunc(phase)) % 4;
    return p % 2 === 0 ? 'G' : 'Y';
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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

  private vehicleColor(speed: number): string {
    const s = Number.isFinite(speed) ? speed : 0;
    const max = 14;
    const t = Math.max(0, Math.min(1, s / max));
    const clamped = Math.max(0, Math.min(1, t));
    const a = 0.95;
    const lerp = (x: number, y: number, k: number) => x + (y - x) * k;
    const toRgb = (r: number, g: number, b: number) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
    // blue -> yellow -> red
    if (clamped < 0.5) {
      const k = clamped / 0.5;
      return toRgb(lerp(80, 255, k), lerp(170, 220, k), lerp(255, 80, k));
    }
    const k = (clamped - 0.5) / 0.5;
    return toRgb(255, lerp(220, 60, k), lerp(80, 60, k));
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
    const byTls = this.snapshotsByTlsId();

    // Merge halted counts across all TLS snapshots (each snapshot contains only lanes controlled by its tlsId)
    const haltedByLane: Record<string, number> = {};
    for (const s of Object.values(byTls)) {
      const lanes = (s as any)?.lanes as Record<string, number> | undefined;
      if (!lanes) continue;
      for (const [k, v] of Object.entries(lanes)) {
        const n = Number(v);
        haltedByLane[k] = (haltedByLane[k] ?? 0) + (Number.isFinite(n) ? n : 0);
      }
    }

    const padding = 3 * dpr;
    const innerW = Math.max(1, w - padding * 2);
    const innerH = Math.max(1, h - padding * 2);
    const spanX = Math.max(1e-6, net.bounds.maxX - net.bounds.minX);
    const spanY = Math.max(1e-6, net.bounds.maxY - net.bounds.minY);
    // Fill available canvas with minimal dead space (non-uniform scaling).
    // This keeps the whole network visible (no cropping) and makes better use of the canvas.
    const scaleX = innerW / spanX;
    const scaleY = innerH / spanY;

    const offsetX = padding;
    const offsetY = padding;

    const toCanvas = (p: { x: number; y: number }) => {
      const x = offsetX + (p.x - net.bounds.minX) * scaleX;
      // SUMO y goes up; canvas y goes down
      const y = offsetY + (net.bounds.maxY - p.y) * scaleY;
      return { x, y };
    };

    // Subtle city blocks background to reduce large black areas between roads.
    // We infer the grid from junction x/y coordinates.
    const xs = Array.from(new Set(net.junctions.map((j) => j.x))).sort((a, b) => a - b);
    const ys = Array.from(new Set(net.junctions.map((j) => j.y))).sort((a, b) => a - b);
    if (xs.length >= 2 && ys.length >= 2) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
      for (let xi = 0; xi < xs.length - 1; xi++) {
        for (let yi = 0; yi < ys.length - 1; yi++) {
          const x0 = xs[xi];
          const x1 = xs[xi + 1];
          const y0 = ys[yi];
          const y1 = ys[yi + 1];
          const p0 = toCanvas({ x: x0, y: y0 });
          const p1 = toCanvas({ x: x1, y: y1 });
          const left = Math.min(p0.x, p1.x);
          const top = Math.min(p0.y, p1.y);
          const ww = Math.abs(p1.x - p0.x);
          const hh = Math.abs(p1.y - p0.y);
          // Keep some margin so blocks don't overlap roads too much
          const m = 14 * dpr;
          if (ww > m * 2 && hh > m * 2) {
            ctx.fillRect(left + m, top + m, ww - m * 2, hh - m * 2);
          }
        }
      }
    }

    // Road bed underlay (wide) to make roads look thicker and reduce perceived black margins.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(28 * dpr, 20);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
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

    // Base roads
    ctx.lineWidth = Math.max(5.5 * dpr, 3.8);
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

    // Junctions (all) + labels (so you can see all 12 intersections)
    ctx.fillStyle = 'rgba(232, 238, 252, 0.75)';
    ctx.font = `${10 * dpr}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const j of net.junctions) {
      const p = toCanvas({ x: j.x, y: j.y });
      ctx.fillStyle = 'rgba(180, 190, 205, 0.7)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(232, 238, 252, 0.75)';
      ctx.fillText(j.id, p.x, p.y);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';

    // Vehicles (real positions if provided by simulator)
    const vehicles = this.vehiclesSnapshot() as
      | Array<{ id: string; x: number; y: number; speed?: number; angle?: number }>
      | undefined;
    if (this.showVehicles() && vehicles && vehicles.length > 0) {
      const count = Math.min(this.maxVehiclesToDraw, vehicles.length);
      const stride = Math.max(1, Math.floor(vehicles.length / count));
      for (let i = 0; i < vehicles.length; i += stride) {
        const v = vehicles[i];
        if (!v) continue;
        const p = toCanvas({ x: v.x, y: v.y });
        const sp = Number(v.speed ?? 0);
        const stepNow = Number((snapshot as any)?.step ?? 0);
        const prev = this.vehicleMotion.get(v.id);
        const prevSpeed = prev?.lastSpeed ?? 0;
        const startedThisStep = prevSpeed <= 0.1 && sp > 0.3;
        const lastStartedStep = startedThisStep ? stepNow : (prev?.lastStartedStep ?? -999999);
        this.vehicleMotion.set(v.id, { lastSpeed: sp, lastStartedStep });
        const angleDeg = Number(v.angle);
        // SUMO angle: 0=east, 90=north (CCW, y-up). Canvas: y-down.
        // Mapping: rotate by (90 - angle) so that 90(north) becomes 0(up) visually.
        const rad = Number.isFinite(angleDeg) ? ((90 - angleDeg) * Math.PI) / 180 : 0;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(rad);

        const carL = 10.5 * dpr;
        const carW = 5.4 * dpr;
        const r = 1.4 * dpr;
        const x0 = -carL / 2;
        const y0 = -carW / 2;

        ctx.fillStyle = this.vehicleStateColor(sp, stepNow - lastStartedStep);
        this.roundRect(ctx, x0, y0, carL, carW, r);
        ctx.fill();

        ctx.fillStyle = 'rgba(8, 10, 16, 0.55)';
        this.roundRect(ctx, x0 + carL * 0.18, y0 + carW * 0.18, carL * 0.34, carW * 0.64, 1.0 * dpr);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.fillRect(x0 + carL * 0.38, y0 + carW * 0.16, carL * 0.08, carW * 0.68);

        ctx.restore();
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

    let panelCount = 0;

    // Traffic lights (one per incoming arm)
    for (const j of net.lights) {
      const p = toCanvas({ x: j.x, y: j.y });
      const tlsSnap = byTls[j.id];
      const phase = tlsSnap?.phase;
      const laneSignalStates = (tlsSnap as any)?.laneSignalStates as Record<string, string> | undefined;
      const haltedLocal = tlsSnap?.lanes ?? {};

      const eps = 1e-3;
      const isTop = Math.abs(j.y - net.bounds.maxY) < eps;
      const isBottom = Math.abs(j.y - net.bounds.minY) < eps;
      const isLeft = Math.abs(j.x - net.bounds.minX) < eps;
      const isRight = Math.abs(j.x - net.bounds.maxX) < eps;

      const preferOutward: 'up' | 'down' | 'left' | 'right' | null = isTop
        ? 'up'
        : isBottom
          ? 'down'
          : isLeft
            ? 'left'
            : isRight
              ? 'right'
              : null;

      const lanesByEdge: Record<string, string[]> = {};
      for (const laneId of j.incLanes) {
        const incomingEdgeId = laneId.replace(/_\d+$/, '');
        (lanesByEdge[incomingEdgeId] ??= []).push(laneId);
      }

      for (const laneIds of Object.values(lanesByEdge)) {
        laneIds.sort();

        let lane: LaneShape | undefined;
        let laneId: string | null = null;
        for (const candidate of laneIds) {
          const l = net.laneById[candidate];
          if (l && l.points.length >= 2) {
            lane = l;
            laneId = candidate;
            break;
          }
        }
        if (!lane || !laneId) continue;

        const arm = this.incomingArmAnchor(lane.points, net, toCanvas, dpr, preferOutward);
        if (!arm) continue;

        const signalCh = laneSignalStates?.[laneId];
        const fromSignal = this.armStateFromSignalChar(signalCh);
        const halted = Number((haltedLocal as any)[laneId] ?? 0);
        const armState = fromSignal ?? this.armStateFromHalted(halted);

        const finalState = laneSignalStates ? armState : 'Y';
        this.drawTrafficLight(ctx, arm.x, arm.y, phase, dpr, 0.75, finalState);
        panelCount++;
      }
    }

    this.drawIncidentOverlay(ctx, net, toCanvas, dpr);

    // HUD
    ctx.fillStyle = 'rgba(232, 238, 252, 0.85)';
    ctx.font = `${12 * dpr}px system-ui`;
    ctx.fillText(
      `lanes=${net.lanes.length}  panels=${panelCount}  tls=${snapshot?.tlsId ?? '-'}  step=${snapshot?.step ?? '-'}`,
      16 * dpr,
      22 * dpr
    );
  }

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
    const laneById: Record<string, LaneShape> = {};
    const lights: Array<{ id: string; x: number; y: number; incLanes: string[] }> = [];
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
      laneById[id] = { id, points: pts };
    }

    const extraCornerLights = new Set(['A0', 'A2', 'D0', 'D2']);

    for (const el of junctionEls) {
      const type = el.getAttribute('type') ?? '';
      const id = el.getAttribute('id') ?? '';

      // Normal traffic-light junctions, plus corner junctions (priority) for UI consistency.
      const isTrafficLight = type === 'traffic_light';
      const isCornerLight = extraCornerLights.has(id);
      if (!isTrafficLight && !isCornerLight) continue;

      const x = Number(el.getAttribute('x'));
      const y = Number(el.getAttribute('y'));
      const incRaw = el.getAttribute('incLanes') ?? '';
      const incLanes = incRaw
        .split(' ')
        .map((s) => s.trim())
        .filter((s) => !!s);
      if (!id || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      lights.push({ id, x, y, incLanes });
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

    return { lanes, laneById, lights, junctions, bounds: { minX, minY, maxX, maxY } };
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
        if (type === 'BREAKDOWN') {
          this.drawStoppedCar(ctx, p.x, p.y, mid.angleRad, dpr);
        } else if (type === 'ACCIDENT') {
          this.drawAccidentCars(ctx, p.x, p.y, mid.angleRad, dpr);
        } else if (type === 'TRAVAUX') {
          this.drawBlockedLane(ctx, lane.points, toCanvas, dpr);
          this.drawIncidentMarker(ctx, p.x, p.y, type, dpr);
        } else {
          this.drawIncidentMarker(ctx, p.x, p.y, type, dpr);
        }
        continue;
      }

      if (junctionId) {
        const j = net.junctions.find((x) => x.id === junctionId);
        if (!j) continue;
        const p = toCanvas({ x: j.x, y: j.y });
        if (type === 'ACCIDENT') {
          this.drawAccidentCars(ctx, p.x, p.y, undefined, dpr);
        } else {
          this.drawIncidentMarker(ctx, p.x, p.y, type, dpr);
        }
      }
    }
  }

  private drawAccidentCars(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angleRad: number | undefined,
    dpr: number
  ): void {
    const ang = Number.isFinite(angleRad as number) ? (angleRad as number) : 0;
    const off = 6.5 * dpr;

    // place two cars with opposite small rotation and slight lateral separation
    const nx = Math.cos(ang + Math.PI / 2);
    const ny = Math.sin(ang + Math.PI / 2);

    this.drawStoppedCar(ctx, x + nx * off, y + ny * off, ang + 0.35, dpr);
    this.drawStoppedCar(ctx, x - nx * off, y - ny * off, ang - 0.35 + Math.PI, dpr);
  }

  private drawIncidentMarker(ctx: CanvasRenderingContext2D, x: number, y: number, type: string, dpr: number): void {
    ctx.save();
    ctx.translate(x, y);

    const r = 9 * dpr;
    const fill = type === 'TRAVAUX' ? 'rgba(255, 70, 70, 0.95)' : 'rgba(255, 120, 40, 0.95)';
    ctx.fillStyle = fill;
    ctx.strokeStyle = 'rgba(12, 14, 18, 0.65)';
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(12, 14, 18, 0.85)';
    ctx.font = `${10 * dpr}px system-ui`;
    const label = type === 'TRAVAUX' ? 'T' : '!';
    const m = ctx.measureText(label);
    ctx.fillText(label, -m.width / 2, 3.5 * dpr);

    ctx.restore();
  }

  private drawStoppedCar(ctx: CanvasRenderingContext2D, x: number, y: number, angleRad: number, dpr: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angleRad);

    const carL = 14 * dpr;
    const carW = 7 * dpr;
    const r = 1.8 * dpr;
    const x0 = -carL / 2;
    const y0 = -carW / 2;

    ctx.fillStyle = 'rgba(255, 70, 70, 0.98)';
    this.roundRect(ctx, x0, y0, carL, carW, r);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 1.1 * dpr;
    ctx.stroke();

    ctx.restore();
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
    const ang = Math.atan2(-n.x, n.y);
    return { p: { x: p.x, y: p.y }, angleRad: ang };
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

  private polySegments(
    points: Array<{ x: number; y: number }>
  ): { total: number; segs: Array<{ a: any; b: any; len: number }> } {
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
