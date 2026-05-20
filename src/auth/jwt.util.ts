import { createHmac, timingSafeEqual } from 'crypto';

interface JwtPayload {
  sub: number;
  email: string;
  iat: number;
  exp: number;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signPart(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

export function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds: number
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const body = base64UrlJson({ ...payload, iat: now, exp: now + ttlSeconds });
  const unsigned = `${header}.${body}`;
  return `${unsigned}.${signPart(unsigned, secret)}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const [header, body, signature] = token.split('.');
  if (!header || !body || !signature) {
    return null;
  }

  const expected = Buffer.from(signPart(`${header}.${body}`, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as JwtPayload;
    if (!payload.sub || !payload.email || !payload.exp) {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
