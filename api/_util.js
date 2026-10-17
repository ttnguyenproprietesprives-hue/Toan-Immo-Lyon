// Fonctions partagées par les routes API (non exposé comme route : préfixe "_").
import { Redis } from '@upstash/redis';

export function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

// Échappe le texte avant insertion dans du HTML (emails, pages)
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Texte court et propre venant d'un formulaire
export function clip(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}

// Envoi d'un lead par email via Formspree (FORMSPREE_ID sur Vercel)
export async function envoyerLead(payload) {
  const r = await fetch('https://formspree.io/f/' + process.env.FORMSPREE_ID, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error('Formspree ' + r.status);
}

// Limite le nombre d'appels par IP (max par heure). Sans Redis configuré, pas de limite.
export async function limiteAtteinte(req, cle, max) {
  if (!process.env.STORAGE_URL || !process.env.STORAGE_TOKEN) return false;
  try {
    const redis = new Redis({ url: process.env.STORAGE_URL, token: process.env.STORAGE_TOKEN });
    const ip = String(req.headers['x-forwarded-for'] || 'inconnu').split(',')[0].trim();
    const k = `rl:${cle}:${ip}`;
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, 3600);
    return n > max;
  } catch (e) {
    console.error('rate limit:', e);
    return false;
  }
}
