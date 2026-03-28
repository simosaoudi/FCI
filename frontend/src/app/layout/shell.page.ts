import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { SimulationService } from '../services/simulation.service';
import { TrafficWsService } from '../services/traffic-ws.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink],
  template: `
    <div class="shell">
      <header class="topbar">
        <a class="brand" routerLink="/">Traffic Optimization</a>
        <div class="status">
          <span class="dot" [class.ok]="ws.connected()"></span>
          <span>{{ ws.connected() ? 'connected' : 'disconnected' }}</span>
        </div>
        <div class="controls">
          <div class="control">
            <label>Vitesse</label>
            <input
              type="range"
              min="0.2"
              max="2"
              step="0.1"
              [value]="speedFactor()"
              (input)="onSpeedInput(($any($event.target).value))"
            />
            <span class="mono">{{ speedFactor().toFixed(1) }}x</span>
          </div>

          <div class="control">
            <label>Accident</label>
            <select [value]="accidentJunctionId()" (change)="onAccidentChange(($any($event.target).value))">
              <option value="">-</option>
              @for (j of junctionOptions(); track j) {
                <option [value]="j">{{ j }}</option>
              }
            </select>
          </div>

          <div class="scenario">
            <button class="chip" type="button" (click)="setScenario('normal')" [class.active]="scenario() === 'normal'">Normal</button>
            <button class="chip" type="button" (click)="setScenario('pic')" [class.active]="scenario() === 'pic'">Pic</button>
            <button class="chip" type="button" (click)="setScenario('incident')" [class.active]="scenario() === 'incident'">Incident</button>
          </div>
        </div>
      </header>

      <main class="content">
        <router-outlet />
      </main>
    </div>
  `,
  styles: [
    `
      .shell {
        min-height: 100vh;
        background: radial-gradient(1200px 600px at 10% 10%, rgba(0, 255, 255, 0.08), transparent 60%),
          radial-gradient(1200px 600px at 90% 20%, rgba(120, 0, 255, 0.09), transparent 65%),
          #070b12;
        color: #e8eefc;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }

      .topbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        gap: 1rem;
        align-items: center;
        padding: 1rem 1.25rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(7, 11, 18, 0.72);
        backdrop-filter: blur(10px);
      }

      .brand {
        color: #e8eefc;
        font-weight: 700;
        text-decoration: none;
        letter-spacing: 0.2px;
      }

      .status {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: rgba(232, 238, 252, 0.8);
        font-size: 0.9rem;
      }

      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: rgba(255, 80, 80, 0.7);
        box-shadow: 0 0 0 3px rgba(255, 80, 80, 0.15);
      }

      .dot.ok {
        background: rgba(0, 255, 170, 0.75);
        box-shadow: 0 0 0 3px rgba(0, 255, 170, 0.15);
      }

      .controls {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .control {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.35rem 0.6rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.03);
        border-radius: 12px;
      }

      .control label {
        color: rgba(232, 238, 252, 0.72);
        font-size: 0.82rem;
      }

      .control input[type='range'] {
        width: 110px;
      }

      .control select {
        background: rgba(0, 0, 0, 0.2);
        color: rgba(232, 238, 252, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        padding: 0.25rem 0.4rem;
      }

      .scenario {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
        font-size: 0.85rem;
        color: rgba(232, 238, 252, 0.85);
      }

      .chip {
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: rgba(232, 238, 252, 0.92);
        border-radius: 999px;
        padding: 0.4rem 0.7rem;
        cursor: pointer;
      }

      .chip.active {
        border-color: rgba(0, 255, 255, 0.35);
        background: rgba(0, 255, 255, 0.08);
      }

      .content {
        padding: 1.25rem;
      }
    `
  ]
})
export class ShellPage implements OnInit, OnDestroy {
  protected readonly scenario = signal('normal');
  protected readonly speedFactor = signal(1);
  protected readonly accidentJunctionId = signal<string>('');
  protected readonly junctionOptions = signal<string[]>([]);

  constructor(
    protected readonly ws: TrafficWsService,
    private readonly simulation: SimulationService
  ) {}

  ngOnInit(): void {
    this.ws.connect();
    void this.loadJunctions();
  }

  ngOnDestroy(): void {
    this.ws.disconnect();
  }

  protected async setScenario(next: string): Promise<void> {
    await this.simulation.setScenario(next);
    this.scenario.set(next);
  }

  protected async onSpeedInput(v: string): Promise<void> {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    this.speedFactor.set(n);
    await this.simulation.setSpeedFactor(n);
  }

  protected async onAccidentChange(v: string): Promise<void> {
    this.accidentJunctionId.set(v);
    if (!v) return;
    await this.simulation.setAccidentJunction(v);
  }

  private async loadJunctions(): Promise<void> {
    try {
      const res = await fetch('/reseau_12_carrefours.net.xml', { cache: 'no-store' });
      if (!res.ok) return;
      const xmlText = await res.text();
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
      const junctionEls = Array.from(doc.getElementsByTagName('junction')) as Element[];
      const ids = junctionEls
        .filter((j) => (j.getAttribute('type') ?? '') === 'traffic_light')
        .map((j) => j.getAttribute('id') ?? '')
        .filter((x) => !!x)
        .sort();
      this.junctionOptions.set(ids);
    } catch {
      // ignore
    }
  }
}
