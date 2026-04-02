import { Injectable, computed, signal } from '@angular/core';

export type AppRole = 'admin' | 'operateur' | 'viewer';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _username = signal<string | null>(null);
  private readonly _roles = signal<AppRole[]>([]);

  readonly authenticated = computed(() => true);
  readonly username = computed(() => this._username());
  readonly roles = computed(() => this._roles());

  async ensureInitialized(): Promise<void> {}
  async login(_redirectUri?: string): Promise<void> {}
  async logout(_redirectUri?: string): Promise<void> {}

  hasAnyRole(roles: AppRole[]): boolean {
    return roles.some((r) => this._roles().includes(r));
  }

  async getToken(): Promise<string | null> {
    return null;
  }
}
