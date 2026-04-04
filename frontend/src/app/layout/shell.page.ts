import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { SimulationService } from '../core/services/simulation.service';
import { TrafficWsService } from '../core/services/traffic-ws.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink],
  templateUrl: './shell.page.html',
  styleUrl: './shell.page.scss'
})
export class ShellPage implements OnInit, OnDestroy {
  protected readonly scenario = signal('normal');
  protected readonly speedFactor = signal(1);
  protected readonly tlsMode = signal<'FIXED' | 'OPTIMIZED'>('OPTIMIZED');
  protected readonly vehicleLevel = signal(3);
  protected readonly incidentTargetKind = signal<'junction' | 'lane'>('junction');
  protected readonly accidentJunctionId = signal<string>('');
  protected readonly incidentLaneId = signal<string>('');
  protected readonly incidentType = signal<string>('ACCIDENT');
  protected readonly activeIncidents = computed(() => this.simulation.incidents());
  protected readonly junctionOptions = signal<string[]>([]);
  protected readonly laneOptions = signal<string[]>([]);
  protected readonly isNetworkModule = signal(false);

  // N1=5 concurrent, N2=10, N3=15, N4=20, N5=30, N6=50
  // (computed via period = 90s / target_count in generer_simulation.py)
  private readonly trafficLevels: Array<{ key: string; label: string }> = [
    { key: 'N1', label: 'N1 · ~5 véh.' },
    { key: 'N2', label: 'N2 · ~10 véh.' },
    { key: 'N3', label: 'N3 · ~15 véh.' },
    { key: 'N4', label: 'N4 · ~20 véh.' },
    { key: 'N5', label: 'N5 · ~30 véh.' },
    { key: 'N6', label: 'N6 · ~50 véh.' },
  ];
  protected readonly vehicleLevelLabel = computed(
    () => this.trafficLevels[this.vehicleLevel() - 1]?.label ?? ''
  );

  private routerSub: { unsubscribe: () => void } | null = null;

  constructor(
    protected readonly ws: TrafficWsService,
    private readonly simulation: SimulationService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.ws.connect();

    const applyUrl = (url: string) => {
      const isNet = url === '/network' || url.startsWith('/network?') || url.startsWith('/network#');
      const prev = this.isNetworkModule();
      this.isNetworkModule.set(isNet);
      if (isNet && !prev) {
        void this.loadJunctionsAndLanes();
      }
    };

    applyUrl(this.router.url);
    this.routerSub = this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) {
        applyUrl(e.urlAfterRedirects);
      }
    });
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.routerSub = null;
    this.ws.disconnect();
  }

  protected async setScenario(next: string): Promise<void> {
    await this.simulation.setScenario(next);
    this.scenario.set(next);

    if (next !== 'incident') {
      this.incidentTargetKind.set('junction');
      this.accidentJunctionId.set('');
      this.incidentLaneId.set('');
      this.incidentType.set('ACCIDENT');
      try {
        await this.simulation.clearAccident();
      } catch {
        // ignore
      }
    }
  }

  protected setTlsMode(mode: 'FIXED' | 'OPTIMIZED'): void {
    this.tlsMode.set(mode);
  }

  protected incVehicleLevel(): void {
    this.vehicleLevel.set(Math.min(6, this.vehicleLevel() + 1));
  }

  protected decVehicleLevel(): void {
    this.vehicleLevel.set(Math.max(1, this.vehicleLevel() - 1));
  }

  protected async start(): Promise<void> {
    const level = this.scenario() === 'normal'
      ? this.trafficLevels[this.vehicleLevel() - 1]?.key
      : undefined;
    await this.simulation.start(this.scenario(), this.tlsMode(), level);
  }

  protected async stop(): Promise<void> {
    await this.simulation.stop();
  }

  protected async onSpeedInput(v: string): Promise<void> {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    this.speedFactor.set(n);
    await this.simulation.setSpeedFactor(n);
  }

  protected async onAccidentChange(v: string): Promise<void> {
    this.accidentJunctionId.set(v);
    this.incidentLaneId.set('');
  }

  protected async onLaneIncidentChange(v: string): Promise<void> {
    this.incidentLaneId.set(v);
    this.accidentJunctionId.set('');
  }

  protected async onIncidentTargetKindChange(v: string): Promise<void> {
    const next = v === 'lane' ? 'lane' : 'junction';
    this.incidentTargetKind.set(next);
    this.accidentJunctionId.set('');
    this.incidentLaneId.set('');
    try {
      await this.simulation.clearIncidents();
    } catch {
      // ignore
    }
  }

  protected async onIncidentTypeChange(v: string): Promise<void> {
    this.incidentType.set(v);
  }

  protected async addIncident(): Promise<void> {
    const type = this.incidentType();
    try {
      if (this.incidentTargetKind() === 'lane') {
        const l = this.incidentLaneId();
        if (!l) return;
        await this.simulation.addIncidentLane(l, type);
      } else {
        const j = this.accidentJunctionId();
        if (!j) return;
        await this.simulation.addIncidentJunction(j, type);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Add incident failed', e);
    }
  }

  protected async removeIncidentLane(laneId: string): Promise<void> {
    try {
      await this.simulation.removeIncidentLane(laneId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Remove incident failed', e);
    }
  }

  protected async clearIncidents(): Promise<void> {
    try {
      await this.simulation.clearIncidents();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Clear incidents failed', e);
    }
  }

  private async loadJunctionsAndLanes(): Promise<void> {
    try {
      const res = await fetch('/reseau_12_carrefours.net.xml', { cache: 'no-store' });
      if (!res.ok) return;
      const xmlText = await res.text();
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
      const junctionEls = Array.from(doc.getElementsByTagName('junction')) as Element[];
      const laneEls = Array.from(doc.getElementsByTagName('lane')) as Element[];
      const ids = junctionEls
        .filter((j) => (j.getAttribute('type') ?? '') === 'traffic_light')
        .map((j) => j.getAttribute('id') ?? '')
        .filter((x) => !!x)
        .sort();
      this.junctionOptions.set(ids);

      const lanes = laneEls
        .map((l) => l.getAttribute('id') ?? '')
        .filter((id) => !!id)
        .filter((id) => !id.startsWith(':'))
        .sort();
      this.laneOptions.set(lanes);
    } catch {
      // ignore
    }
  }
}
