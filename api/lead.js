import { parseBody, clip, envoyerLead, limiteAtteinte } from './_util.js';

// Formulaires simples du site : contact, dépôt de bien à vendre, demande de recherche
const SUJETS = {
  contact: 'Nouveau message de contact',
  vendre: 'Nouveau bien à vendre',
  recherche: 'Nouvelle demande de recherche',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    if (await limiteAtteinte(req, 'lead', 10)) return res.status(429).json({ ok: false, error: 'Trop de demandes' });

    const body = parseBody(req);
    const sujet = SUJETS[body.formulaire];
    const champs = body.champs || {};
    if (!sujet || !clip(champs.nom) || !clip(champs.tel)) return res.status(400).json({ ok: false, error: 'Données manquantes' });

    const payload = { _subject: `[Toan Immo] ${sujet}` };
    for (const [k, v] of Object.entries(champs).slice(0, 20)) payload[clip(k, 40)] = clip(v, 2000);

    await envoyerLead(payload);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('lead:', e);
    res.status(500).json({ ok: false, error: 'Envoi impossible' });
  }
}
