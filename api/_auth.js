// Vérification du mot de passe admin (variable d'environnement ADMIN_PASSWORD sur Vercel).
// Les fichiers commençant par "_" dans /api ne sont pas exposés comme routes par Vercel.
import { timingSafeEqual } from 'crypto';

export function isAdmin(req) {
  const expected = process.env.ADMIN_PASSWORD || '';
  // Mot de passe absent ou trop court : tout est refusé plutôt que laissé ouvert
  if (expected.length < 12) return false;

  const headers = req.headers;
  const given = (typeof headers.get === 'function' ? headers.get('x-admin-key') : headers['x-admin-key']) || '';

  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
