// Resolves the authenticated user identity behind the app.
//
// Production: Cloudflare Access (Google IdP) gates mega.yeap.news and exposes
// `/cdn-cgi/access/get-identity` on the same origin. We hit that and read the
// signed-in user's email.
//
// Local dev: Cloudflare isn't in front of `npm run dev`, so the endpoint 404s.
// We fall back to PUBLIC_DEV_AUTH_EMAIL from the .env so the operator can test
// the admin-gated Dashboard locally without setting up CF tunnel.

export interface AuthIdentity {
  email: string;
  name?: string;
  /** "cloudflare" when fetched from /cdn-cgi/access/get-identity, "dev" when
   *  read from PUBLIC_DEV_AUTH_EMAIL, or null when neither was available. */
  source: 'cloudflare' | 'dev' | null;
}

let _cached: AuthIdentity | null | undefined; // undefined = not fetched yet

const stripQuotes = (s: string) => s.replace(/^"+|"+$/g, '').trim();

const readDevEmail = (): string | null => {
  const raw = import.meta.env.PUBLIC_DEV_AUTH_EMAIL;
  if (!raw) return null;
  const trimmed = stripQuotes(String(raw));
  return trimmed.includes('@') ? trimmed.toLowerCase() : null;
};

export const getAuthEmail = async (): Promise<AuthIdentity | null> => {
  if (_cached !== undefined) return _cached;

  // Try Cloudflare Access first (production path).
  try {
    const res = await fetch('/cdn-cgi/access/get-identity', {
      credentials: 'include',
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const email = typeof data?.email === 'string' ? data.email.toLowerCase() : '';
      if (email.includes('@')) {
        _cached = { email, name: typeof data?.name === 'string' ? data.name : undefined, source: 'cloudflare' };
        return _cached;
      }
    }
  } catch {
    // CF endpoint not reachable (local dev, network blip) — fall through to dev fallback
  }

  const devEmail = readDevEmail();
  if (devEmail) {
    _cached = { email: devEmail, source: 'dev' };
    return _cached;
  }

  _cached = null;
  return _cached;
};

/** Clear the cached identity. Useful in tests; rarely needed in app code. */
export const resetAuthIdentityCache = (): void => {
  _cached = undefined;
};
