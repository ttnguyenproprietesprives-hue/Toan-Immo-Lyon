import { parseBody, limiteAtteinte } from './_util.js';
import { compter } from './_leads.js';

// Compteurs anonymes (aucune donnée personnelle) : clics sur les boutons de contact et étapes de l'estimation
const EVENEMENTS = ['clic_tel', 'clic_whatsapp', 'clic_rdv', 'estim_etape2', 'estim_etape3'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { e } = parseBody(req);
    if (!EVENEMENTS.includes(e)) return res.status(400).end();
    if (await limiteAtteinte(req, 'track', 120)) return res.status(429).end();
    await compter(e);
  } catch (err) {
    console.error('track:', err);
  }
  res.status(204).end();
}
