// Enregistrement, notification et statistiques des leads (non exposé comme route : préfixe "_").
// Chaque lead passe par 3 canaux indépendants : la base Upstash (tableau de bord), un email
// de notification immédiat (Resend) et Formspree. Si l'un tombe en panne, les autres prennent le relais.
import { randomBytes } from 'crypto';
import { Redis } from '@upstash/redis';
import { Resend } from 'resend';
import { esc, clip, envoyerLead } from './_util.js';

// Relances par email (uniquement si la personne l'a accepté) : nombre de jours après la demande
export const CALENDRIER_RELANCES = [2, 10, 30, 90];

const SITE = 'https://www.toanimmo-lyon.fr';
const TROIS_ANS = 3 * 365 * 24 * 3600; // durée de conservation annoncée dans la politique de confidentialité

export const TYPES = {
  estimation: 'Estimation en ligne',
  contact: 'Message de contact',
  vendre: 'Bien à vendre',
  recherche: 'Recherche de bien',
};

export function redis() {
  if (!process.env.STORAGE_URL || !process.env.STORAGE_TOKEN) return null;
  return new Redis({ url: process.env.STORAGE_URL, token: process.env.STORAGE_TOKEN });
}

// Mois au format AAAA-MM, heure de Paris
export function moisCle(date = new Date()) {
  return date.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }).slice(0, 7);
}

// Compteur mensuel (clics, étapes de l'estimation…)
export async function compter(evenement) {
  const r = redis();
  if (r) await r.hincrby(`stats:${moisCle()}`, evenement, 1);
}

async function enregistrer(fiche) {
  const r = redis();
  if (!r) throw new Error('base Upstash non configurée');
  await r.set(`lead:${fiche.id}`, fiche, { ex: TROIS_ANS });
  await r.lpush('leads:ids', fiche.id);
  await r.ltrim('leads:ids', 0, 1999);
  await r.hincrby(`stats:${moisCle()}`, `lead_${fiche.type}`, 1);
  if (fiche.relance) await r.sadd('relances:actives', fiche.id);
}

async function notifier(fiche) {
  const to = process.env.LEAD_EMAIL || process.env.VALIDATION_EMAIL;
  if (!process.env.RESEND_API_KEY || !to) throw new Error('email de notification non configuré');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const tel = fiche.tel.replace(/[^\d+]/g, '');
  const lignes = Object.entries(fiche.details)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `<tr><td style="padding:5px 14px 5px 0;color:#7A7670;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:5px 0;color:#3D3B38;font-size:13px">${esc(v)}</td></tr>`)
    .join('');
  const type = TYPES[fiche.type] || fiche.type;
  const nom = `${fiche.prenom} ${fiche.nom}`.trim();

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#F8F7F5;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #EEECE8;">
  <div style="background:#1A2E4A;padding:22px 26px;">
    <div style="color:#C9A84C;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">🔔 Nouveau lead · ${esc(type)}</div>
    <div style="color:#fff;font-size:22px;font-family:Georgia,serif;">${esc(nom)}</div>
    <div style="color:rgba(255,255,255,.6);font-size:13px;margin-top:4px;">${esc(fiche.commune || 'Commune non précisée')}</div>
  </div>
  <div style="padding:22px 26px;">
    <a href="tel:${esc(tel)}" style="display:block;text-align:center;background:#C9A84C;color:#0F1E33;text-decoration:none;font-weight:600;font-size:16px;padding:14px;border-radius:8px;margin-bottom:10px;">📞 Appeler ${esc(fiche.tel)}</a>
    ${fiche.email ? `<a href="mailto:${esc(fiche.email)}" style="display:block;text-align:center;background:#F8F7F5;color:#1A2E4A;text-decoration:none;font-size:14px;padding:11px;border-radius:8px;margin-bottom:18px;border:1px solid #EEECE8;">✉️ ${esc(fiche.email)}</a>` : '<div style="height:8px"></div>'}
    ${fiche.resume ? `<p style="font-size:15px;color:#1A2E4A;background:#FBF8F0;border-left:3px solid #C9A84C;padding:10px 14px;margin:0 0 16px;">${esc(fiche.resume)}</p>` : ''}
    <table style="border-collapse:collapse;width:100%;">${lignes}</table>
    <p style="font-size:12px;color:#B8B4AC;margin:18px 0 0;">Provenance : ${esc(fiche.source || 'inconnue')}</p>
    <p style="margin:18px 0 0;"><a href="${SITE}/tableau-de-bord.html" style="color:#1A2E4A;font-size:13px;">Voir tous les leads dans le tableau de bord →</a></p>
  </div>
</div></body></html>`;

  const { error } = await resend.emails.send({
    from: 'Toan Immo Lyon <tt.nguyen@toanimmo-lyon.fr>',
    to,
    ...(fiche.email ? { reply_to: fiche.email } : {}),
    subject: `🔔 ${type} – ${nom}${fiche.commune ? ' – ' + fiche.commune : ''}`,
    html,
  });
  if (error) throw new Error(error.message || 'Resend');
}

/**
 * Traite un lead : base + email de notification + Formspree.
 * lead = { type, prenom, nom, tel, email, commune, source, resume, details: { libellé: valeur }, formspree: {…} }
 * Renvoie true si au moins un canal a fonctionné.
 */
export async function traiterLead(lead) {
  const fiche = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    date: new Date().toISOString(),
    statut: 'nouveau',
    type: lead.type,
    prenom: clip(lead.prenom, 80),
    nom: clip(lead.nom, 80),
    tel: clip(lead.tel, 40),
    email: clip(lead.email, 120),
    commune: clip(lead.commune, 80),
    source: clip(lead.source, 200),
    resume: clip(lead.resume, 300),
    details: lead.details || {},
    // Estimation chiffrée, réutilisée dans les emails de relance
    ...(lead.estimation ? { estimation: lead.estimation } : {}),
  };
  // Programme de relances : seulement avec un email valide ET le consentement explicite de la personne
  if (lead.relances && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fiche.email)) {
    fiche.relance = {
      active: true,
      etape: 0,
      prochaine: Date.now() + CALENDRIER_RELANCES[0] * 864e5,
      jeton: randomBytes(12).toString('hex'), // sert au lien de désinscription
    };
    fiche.details['Relances email'] = 'acceptées';
  }
  const canaux = { base: enregistrer(fiche), email: notifier(fiche) };
  if (lead.formspree && process.env.FORMSPREE_ID) canaux.formspree = envoyerLead(lead.formspree);
  const noms = Object.keys(canaux);
  const resultats = await Promise.allSettled(Object.values(canaux));
  resultats.forEach((r, i) => { if (r.status === 'rejected') console.error(`lead – canal ${noms[i]} :`, r.reason?.message || r.reason); });
  return resultats.some(r => r.status === 'fulfilled');
}
