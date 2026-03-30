import Keycloak from 'keycloak-js';
import { Injectable, computed, signal } from '@angular/core';

export type AppRole = 'admin' | 'operateur' | 'viewer';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private kc: Keycloak | null = null;
  private initPromise: Promise<void> | null = null;

  private readonly _ready = signal(false);
  private readonly _authenticated = signal(false);
  private readonly _username = signal<string | null>(null);
  private readonly _roles = signal<AppRole[]>([]);

  readonly ready = computed(() => this._ready());
  readonly authenticated = computed(() => this._authenticated());
  readonly username = computed(() => this._username());
  readonly roles = computed(() => this._roles());

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._initInternal();
    return this.initPromise;
  }

  async ensureInitialized(): Promise<void> {
    await this.init();
  }

  private async _initInternal(): Promise<void> {
    const keycloak = new Keycloak({
      url: 'http://localhost:8082',
      realm: 'traffic',
      clientId: 'traffic-frontend'
    });

    // Set early so guard can trigger login even if init is still running
    this.kc = keycloak;

    keycloak.onAuthSuccess = () => {
      this._authenticated.set(true);
      this.syncFromToken();
    };
    keycloak.onAuthRefreshSuccess = () => {
      this._authenticated.set(true);
      this.syncFromToken();
    };
    keycloak.onAuthLogout = () => {
      this._authenticated.set(false);
      this._roles.set([]);
      this._username.set(null);
    };
    keycloak.onTokenExpired = () => {
      void this.updateToken();
    };

    try {
      const authenticated = await keycloak.init({
        onLoad: 'check-sso',
        pkceMethod: 'S256',
        checkLoginIframe: true
      });

      this._authenticated.set(!!authenticated);
      this.syncFromToken();
    } catch {
      // If Keycloak is not reachable yet, still mark ready so guard can call login() later
      this._authenticated.set(false);
      this._roles.set([]);
      this._username.set(null);
    }

    // Attach token automatically for existing fetch-based services
    const originalFetch = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const url = typeof input === 'string' ? input : (input as any)?.url;
        const isApi = typeof url === 'string' && url.startsWith('/api/');
        if (!isApi) return originalFetch(input as any, init);

        const token = await this.getToken();
        if (!token) return originalFetch(input as any, init);

        const headers = new Headers((init as any)?.headers ?? {});
        headers.set('Authorization', `Bearer ${token}`);
        return originalFetch(input as any, { ...(init ?? {}), headers });
      } catch {
        return originalFetch(input as any, init);
      }
    }) as any;

    // refresh token periodically
    window.setInterval(() => {
      void this.updateToken();
    }, 30_000);

    this._ready.set(true);
  }

  private syncFromToken(): void {
    if (!this.kc) return;
    const parsed = (this.kc.tokenParsed as any) ?? {};
    this._username.set(parsed['preferred_username'] ?? null);

    const realmRoles = parsed?.realm_access?.roles;
    const roles: AppRole[] = Array.isArray(realmRoles)
      ? (realmRoles.filter((r: any) => r === 'admin' || r === 'operateur' || r === 'viewer') as AppRole[])
      : [];
    this._roles.set(roles);
  }

  async login(redirectUri?: string): Promise<void> {
    if (!this.kc) return;
    await this.kc.login({ redirectUri: redirectUri ?? window.location.href });
  }

  async logout(redirectUri?: string): Promise<void> {
    if (!this.kc) return;
    await this.kc.logout({ redirectUri: redirectUri ?? window.location.origin + '/' });
  }

  hasAnyRole(roles: AppRole[]): boolean {
    const current = this._roles();
    return roles.some((r) => current.includes(r));
  }

  async getToken(): Promise<string | null> {
    if (!this.kc) return null;
    await this.updateToken();
    return this.kc.token ?? null;
  }

  private async updateToken(): Promise<void> {
    if (!this.kc) return;
    if (!this.kc.authenticated) return;
    try {
      const refreshed = await this.kc.updateToken(30);
      if (refreshed) {
        this._username.set((((this.kc.tokenParsed as any) ?? {})['preferred_username']) ?? null);
      }
    } catch {
      // ignore
    }
  }
}
