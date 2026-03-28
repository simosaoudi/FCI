import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SimulationService {
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
    const res = await fetch(`/api/simulation/accident?junctionId=${encodeURIComponent(junctionId)}`, {
      method: 'POST'
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  }
}
