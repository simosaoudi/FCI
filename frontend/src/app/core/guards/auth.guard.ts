import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.ensureInitialized();

  if (!auth.authenticated()) {
    await auth.login(window.location.origin + state.url);
    return false;
  }

  const allowed = (route.data?.['roles'] as Array<'admin' | 'operateur' | 'viewer'> | undefined) ?? [];
  if (allowed.length > 0 && !auth.hasAnyRole(allowed)) {
    return router.parseUrl('/');
  }

  return true;
};
