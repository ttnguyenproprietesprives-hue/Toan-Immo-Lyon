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

// Traduit une erreur de l'API Anthropic en message clair pour l'utilisateur
export function erreurIA(status, data) {
  const msg = String(data?.error?.message || '').toLowerCase();
  if (msg.includes('credit balance')) return "Crédit IA épuisé : rechargez votre compte sur console.anthropic.com (rubrique Plans & Billing).";
  if (status === 401 || status === 403) return "Clé API Anthropic invalide ou désactivée : vérifiez la variable ANTHROPIC_API_KEY dans Vercel.";
  if (status === 404) return "Le modèle d'IA utilisé n'est plus disponible : le site doit être mis à jour.";
  if (status === 429) return "Trop de demandes envoyées à l'IA : patientez une minute et réessayez.";
  if (status >= 500) return "Le service d'IA est momentanément surchargé : réessayez dans quelques minutes.";
  return `Erreur du service d'IA (code ${status}).`;
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
