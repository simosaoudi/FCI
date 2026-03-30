import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { SimulationService } from '../core/services/simulation.service';
import { TrafficWsService } from '../core/services/traffic-ws.service';
import { AuthService } from '../core/services/auth.service';

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
  protected readonly normalTrafficLevel = signal(2);
  protected readonly incidentTargetKind = signal<'junction' | 'lane'>('junction');
  protected readonly accidentJunctionId = signal<string>('');
  protected readonly incidentLaneId = signal<string>('');
  protected readonly incidentType = signal<string>('ACCIDENT');
  protected readonly activeIncidents = computed(() => this.simulation.incidents());
  protected readonly junctionOptions = signal<string[]>([]);
  protected readonly laneOptions = signal<string[]>([]);
  protected readonly isNetworkModule = signal(false);
  protected readonly profileName = computed(() => this.auth.username() ?? 'Anonyme');
  protected readonly isAuthenticated = computed(() => this.auth.authenticated());

  private routerSub: { unsubscribe: () => void } | null = null;

  constructor(
    protected readonly ws: TrafficWsService,
    private readonly simulation: SimulationService,
    private readonly router: Router,
    protected readonly auth: AuthService
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

  protected async login(): Promise<void> {
    await this.auth.login(window.location.href);
  }

  protected async logout(): Promise<void> {
    await this.auth.logout(window.location.origin + '/');
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

  protected async incNormalTraffic(): Promise<void> {
    await this.adjustNormalTraffic(+1);
  }

  protected async decNormalTraffic(): Promise<void> {
    await this.adjustNormalTraffic(-1);
  }

  private async adjustNormalTraffic(delta: number): Promise<void> {
    const next = Math.max(0, Math.min(6, this.normalTrafficLevel() + delta));
    if (next === this.normalTrafficLevel()) return;
    this.normalTrafficLevel.set(next);

    const { period, fringe } = this.normalTrafficParams(next);
    try {
      await this.simulation.setTraffic('normal', period, fringe);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Traffic adjust failed', e);
    }
  }

  private normalTrafficParams(level: number): { period: number; fringe: number } {
    // Higher level => more vehicles
    const presets: Array<{ period: number; fringe: number }> = [
      { period: 40, fringe: 0.7 },
      { period: 28, fringe: 0.9 },
      { period: 20, fringe: 1.0 },
      { period: 14, fringe: 1.2 },
      { period: 10, fringe: 1.6 },
      { period: 7, fringe: 2.2 },
      { period: 5, fringe: 3.0 }
    ];
    const idx = Math.max(0, Math.min(presets.length - 1, Math.floor(level)));
    return presets[idx];
  }

  protected async start(): Promise<void> {
    await this.simulation.start(this.scenario());
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
