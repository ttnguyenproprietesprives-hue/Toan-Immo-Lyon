import { Redis } from '@upstash/redis';
import { Resend } from 'resend';

export const config = { runtime: 'nodejs' };

const redis = new Redis({
  url: process.env.STORAGE_URL,
  token: process.env.STORAGE_TOKEN,
});

const resend = new Resend(process.env.RESEND_API_KEY);
const BASE_URL = 'https://www.toanimmo-lyon.fr';

const PLATFORM_LABELS = {
  facebook: { icon: '👥', name: 'Facebook', color: '#1877F2' },
  instagram: { icon: '📸', name: 'Instagram', color: '#E1306C' },
  linkedin: { icon: '💼', name: 'LinkedIn', color: '#0A66C2' },
  google: { icon: '🗺️', name: 'Google Business', color: '#34A853' },
};

function truncate(str, max = 300) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function buildEmailHtml({ token, commune, sujet, saison, content, images }) {
  const communeName = commune.split(' (')[0];
  const platforms = ['facebook', 'instagram', 'linkedin', 'google'];

  const platformCards = platforms.map(p => {
    const label = PLATFORM_LABELS[p];
    const text = content[p] || '';
    const imgUrl = images[p] || '';
    const approveUrl = `${BASE_URL}/api/approve?token=${token}&platform=${p}&action=approve`;
    const rejectUrl = `${BASE_URL}/api/approve?token=${token}&platform=${p}&action=reject`;

    return `
    <div style="margin-bottom:28px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="background:${label.color};padding:14px 20px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:20px;">${label.icon}</span>
        <span style="color:#fff;font-weight:600;font-size:15px;">${label.name}</span>
      </div>
      ${imgUrl ? `<img src="${imgUrl}" style="width:100%;max-height:280px;object-fit:cover;" alt="Visuel ${label.name}" />` : ''}
      <div style="padding:16px 20px;background:#fafafa;">
        <p style="font-size:13px;color:#374151;line-height:1.7;white-space:pre-wrap;margin:0 0 16px;">${truncate(text)}</p>
        <div style="display:flex;gap:10px;">
          <a href="${approveUrl}" style="display:inline-block;padding:10px 22px;background:#1A2E4A;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">✅ Approuver</a>
          <a href="${rejectUrl}" style="display:inline-block;padding:10px 22px;background:#f3f4f6;color:#6b7280;border-radius:8px;text-decoration:none;font-size:14px;">❌ Rejeter</a>
        </div>
      </div>
    </div>`;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:640px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#1A2E4A;padding:28px 32px;text-align:center;">
      <div style="width:48px;height:48px;border-radius:50%;background:#C9A84C;display:inline-flex;align-items:center;justify-content:center;font-family:Georgia,serif;font-size:18px;font-weight:700;color:#1A2E4A;margin-bottom:12px;">TI</div>
      <h1 style="color:#fff;font-size:20px;margin:0 0 4px;font-family:Georgia,serif;">Validation de contenu</h1>
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0;">${communeName} · ${sujet} · ${saison}</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="color:#374151;font-size:15px;margin:0 0 24px;">Voici le contenu généré pour <strong>${communeName}</strong>. Approuve ou rejette chaque plateforme ci-dessous.</p>
      ${platformCards}
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:24px;">Ce lien est valable 48h · Toan Immo Lyon</p>
    </div>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { commune, sujet, saison, content, images } = req.body;
  if (!content || !commune) return res.status(400).json({ error: 'Missing data' });

  const token = crypto.randomUUID();

  await redis.set(`validation:${token}`, {
    commune, sujet, saison, content, images,
    status: { facebook: 'pending', instagram: 'pending', linkedin: 'pending', google: 'pending' },
    createdAt: Date.now(),
  }, { ex: 172800 });

  const html = buildEmailHtml({ token, commune, sujet, saison, content, images });

  const { error } = await resend.emails.send({
    from: 'Toan Immo Lyon <contenu@toanimmo-lyon.fr>',
    to: process.env.VALIDATION_EMAIL,
    subject: `📋 Validation contenu — ${commune.split(' (')[0]}`,
    html,
  });

  if (error) {
    console.error('Resend error:', error);
    return res.status(500).json({ error: 'Email send failed', detail: error });
  }

  return res.status(200).json({ success: true, token });
}
