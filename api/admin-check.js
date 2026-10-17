import { isAdmin } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  // Petit délai pour freiner les essais de mot de passe en rafale
  await new Promise(r => setTimeout(r, 400));
  if (!isAdmin(req)) return res.status(401).json({ ok: false });
  res.status(200).json({ ok: true });
}
