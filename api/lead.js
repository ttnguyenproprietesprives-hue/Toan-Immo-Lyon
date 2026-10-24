import { parseBody, clip, limiteAtteinte } from './_util.js';
import { traiterLead } from './_leads.js';

// Formulaires simples du site : contact, dépôt de bien à vendre, demande de recherche
const SUJETS = {
  contact: 'Nouveau message de contact',
  vendre: 'Nouveau bien à vendre',
  recherche: 'Nouvelle demande de recherche',
};

// Libellés lisibles pour l'email et le tableau de bord
const LIBELLES = { type: 'Type de bien', commune: 'Commune', surface: 'Surface (m²)', prix: 'Prix souhaité', budget: 'Budget', objet: 'Objet', message: 'Message', criteres: 'Critères' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    if (await limiteAtteinte(req, 'lead', 10)) return res.status(429).json({ ok: false, error: 'Trop de demandes' });

    const body = parseBody(req);
    const sujet = SUJETS[body.formulaire];
    const champs = body.champs || {};
    if (!sujet || !clip(champs.nom) || !clip(champs.tel)) return res.status(400).json({ ok: false, error: 'Données manquantes' });

    const formspree = { _subject: `[Toan Immo] ${sujet}` };
    for (const [k, v] of Object.entries(champs).slice(0, 20)) formspree[clip(k, 40)] = clip(v, 2000);

    const details = {};
    for (const [k, libelle] of Object.entries(LIBELLES)) if (clip(champs[k])) details[libelle] = clip(champs[k], 2000);

    const ok = await traiterLead({
      type: body.formulaire,
      prenom: '',
      nom: champs.nom,
      tel: champs.tel,
      email: champs.email,
      commune: champs.commune,
      source: champs.source,
      resume: clip(champs.message || champs.criteres || champs.objet, 300),
      details,
      formspree,
    });
    if (!ok) throw new Error('aucun canal disponible');
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('lead:', e);
    res.status(500).json({ ok: false, error: 'Envoi impossible' });
  }
}
