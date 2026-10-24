import { isAdmin } from './_auth.js';
import { parseBody } from './_util.js';
import { redis, moisCle } from './_leads.js';

const STATUTS = ['nouveau', 'rappelé', 'rdv', 'mandat', 'perdu'];

// Tableau de bord (accès admin uniquement) : liste des leads, statistiques, changement de statut
export default async function handler(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
  const r = redis();
  if (!r) return res.status(500).json({ error: 'Base Upstash non configurée (STORAGE_URL / STORAGE_TOKEN).' });

  try {
    if (req.method === 'GET') {
      const ids = await r.lrange('leads:ids', 0, 299);
      const fiches = ids.length ? await r.mget(...ids.map(id => `lead:${id}`)) : [];
      const maintenant = new Date();
      const precedent = new Date(maintenant.getFullYear(), maintenant.getMonth() - 1, 15);
      const [statsMois, statsPrecedent] = await Promise.all([
        r.hgetall(`stats:${moisCle(maintenant)}`),
        r.hgetall(`stats:${moisCle(precedent)}`),
      ]);
      return res.status(200).json({
        leads: fiches.filter(Boolean),
        stats: { mois: statsMois || {}, precedent: statsPrecedent || {} },
        mois: moisCle(maintenant),
      });
    }

    if (req.method === 'POST') {
      const { id, statut } = parseBody(req);
      if (!STATUTS.includes(statut) || !/^[a-z0-9]+$/.test(String(id))) return res.status(400).json({ error: 'Données invalides' });
      const fiche = await r.get(`lead:${id}`);
      if (!fiche) return res.status(404).json({ error: 'Lead introuvable' });
      fiche.statut = statut;
      await r.set(`lead:${id}`, fiche, { keepTtl: true });
      return res.status(200).json({ ok: true });
    }

    res.status(405).end();
  } catch (e) {
    console.error('leads:', e);
    res.status(500).json({ error: 'Erreur de lecture des leads' });
  }
}
