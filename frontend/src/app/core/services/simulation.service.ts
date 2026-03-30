import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SimulationService {
  readonly incidents = signal<Array<{ junctionId?: string; laneId?: string; incidentType: string }>>([]);

  async setTraffic(scenario: string, period: number, fringe: number): Promise<void> {
    const res = await fetch(`/api/simulation/traffic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario, period, fringe })
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  async start(scenario: string): Promise<void> {
    const res = await fetch(`/api/simulation/start?scenario=${encodeURIComponent(scenario)}`, {
      method: 'POST'
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  async stop(): Promise<void> {
    const res = await fetch(`/api/simulation/stop`, {
      method: 'POST'
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  async setScenario(scenario: string): Promise<void> {
    const res = await fetch(`/api/simulation/scenario?scenario=${encodeURIComponent(scenario)}`, {
      method: 'POST'
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  async setSpeedFactor(speedFactor: number): Promise<void> {
    const res = await fetch(`/api/simulation/speed?speedFactor=${encodeURIComponent(String(speedFactor))}`, {
      method: 'POST'
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  async setAccidentJunction(junctionId: string): Promise<void> {
    await this.setIncident(junctionId, 'ACCIDENT');
  }

  async setIncident(junctionId: string, incidentType: string): Promise<void> {
    // Backward-compat: set single incident by clearing and then adding
    await this.clearIncidents();
    await this.addIncidentJunction(junctionId, incidentType);
  }

  async addIncidentJunction(junctionId: string, incidentType: string): Promise<void> {
    this.incidents.update((prev) => {
      const idx = prev.findIndex((x) => x.junctionId === junctionId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], junctionId, incidentType };
        return next;
      }
      return [...prev, { junctionId, incidentType }];
    });
    const res = await fetch(`/api/simulation/incidents/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ junctionId, incidentType })
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  async setIncidentLane(laneId: string, incidentType: string): Promise<void> {
    // Backward-compat: set single lane incident by clearing and then adding
    await this.clearIncidents();
    await this.addIncidentLane(laneId, incidentType);
  }

  async addIncidentLane(laneId: string, incidentType: string): Promise<void> {
    this.incidents.update((prev) => {
      const idx = prev.findIndex((x) => x.laneId === laneId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], laneId, incidentType };
        return next;
      }
      return [...prev, { laneId, incidentType }];
    });
    const res = await fetch(`/api/simulation/incidents/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ laneId, incidentType })
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  async removeIncidentLane(laneId: string): Promise<void> {
    this.incidents.update((prev) => prev.filter((x) => x.laneId !== laneId));
    const res = await fetch(`/api/simulation/incidents/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ laneId })
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  async clearIncidents(): Promise<void> {
    this.incidents.set([]);
    const res = await fetch(`/api/simulation/incidents/clear`, { method: 'POST' });
    if (!res.ok) {
      // fallback to old clear endpoint
      const fallback = await fetch(`/api/simulation/accident/clear`, { method: 'POST' });
      if (!fallback.ok) throw new Error(`HTTP ${res.status}`);
    }
  }

  async clearAccident(): Promise<void> {
    await this.clearIncidents();
  }
}
