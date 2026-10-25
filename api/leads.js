import { Resend } from 'resend';
import { isAdmin } from './_auth.js';
import { parseBody, esc } from './_util.js';
import { redis, moisCle, compter } from './_leads.js';

const STATUTS = ['nouveau', 'rappelé', 'rdv', 'mandat', 'vendu', 'perdu'];
const LIEN_AVIS_GOOGLE = 'https://g.page/r/CWXo7roLQ-gZEAE/review';

// Email de remerciement et de demande d'avis Google, envoyé une seule fois quand un lead passe en « Vente conclue »
async function demanderAvis(fiche) {
  if (!process.env.RESEND_API_KEY || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fiche.email || '')) return false;
  const prenom = esc(fiche.prenom || fiche.nom || '');
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#F8F7F5;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #EEECE8;">
  <div style="background:#1A2E4A;padding:22px 28px;">
    <div style="color:#C9A84C;font-size:12px;text-transform:uppercase;letter-spacing:.08em;">Toan Immo Lyon</div>
    <div style="color:#fff;font-size:21px;font-family:Georgia,serif;margin-top:6px;">Merci pour votre confiance</div>
  </div>
  <div style="padding:24px 28px;font-size:15px;line-height:1.7;color:#3D3B38;">
    <p>Bonjour ${prenom},</p>
    <p>Je tenais à vous remercier sincèrement pour votre confiance tout au long de ce projet. Ce fut un plaisir de vous accompagner jusqu'à la signature.</p>
    <p>Si vous avez été satisfait de mon accompagnement, <strong>pourriez-vous prendre 30 secondes pour laisser un avis sur Google ?</strong> C'est la meilleure façon d'aider d'autres propriétaires de l'Est lyonnais à me trouver, et cela compte énormément pour un conseiller indépendant.</p>
    <div style="text-align:center;margin:26px 0;">
      <a href="${LIEN_AVIS_GOOGLE}" style="display:inline-block;background:#C9A84C;color:#0F1E33;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:8px;">⭐ Laisser un avis sur Google</a>
    </div>
    <p>Et si un proche a un projet immobilier, je serai ravi de l'accompagner avec le même soin.</p>
    <p style="margin:18px 0 0;">Encore merci, et bonne continuation !<br/><strong>Toam Nguyen</strong><br/><span style="color:#7A7670;font-size:13px;">Conseiller immobilier · Réseau Propriétés-Privées · 06 60 02 27 25</span></p>
  </div>
</div></body></html>`;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: 'Toam Nguyen – Toan Immo Lyon <tt.nguyen@toanimmo-lyon.fr>',
    to: fiche.email,
    reply_to: 'tt-nguyen@proprietes-privees.com',
    subject: 'Merci pour votre confiance – votre avis compte',
    html,
  });
  if (error) throw new Error(error.message || 'Resend');
  return true;
}

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
      let avis = null;
      if (statut === 'vendu' && !fiche.avisDemande) {
        try {
          if (await demanderAvis(fiche)) {
            fiche.avisDemande = new Date().toISOString();
            avis = 'envoyé';
            await compter('avis_demande');
          } else avis = 'pas d\'email';
        } catch (e) {
          console.error('demande d\'avis :', e.message);
          avis = 'erreur';
        }
      }
      await r.set(`lead:${id}`, fiche, { keepTtl: true });
      return res.status(200).json({ ok: true, avis });
    }

    res.status(405).end();
  } catch (e) {
    console.error('leads:', e);
    res.status(500).json({ error: 'Erreur de lecture des leads' });
  }
}
