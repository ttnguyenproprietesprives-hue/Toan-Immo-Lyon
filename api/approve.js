import { Redis } from '@upstash/redis';
import { nettoyerPostGoogle } from './_util.js';

export const config = { runtime: 'nodejs' };

const redis = new Redis({
  url: process.env.STORAGE_URL,
  token: process.env.STORAGE_TOKEN,
});

// ── Platform publishers ──────────────────────────────────────────────────────

async function publishFacebook(content, imageUrl) {
  const pageId = process.env.META_PAGE_ID;
  const token = process.env.META_PAGE_ACCESS_TOKEN;

  if (imageUrl) {
    const photoRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
      method: 'POST',
      body: new URLSearchParams({ url: imageUrl, caption: content, access_token: token }),
    });
    const photoData = await photoRes.json();
    if (!photoRes.ok) throw new Error(photoData.error?.message || 'Facebook photo upload failed');
    return { id: photoData.id, platform: 'facebook' };
  }

  const postRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method: 'POST',
    body: new URLSearchParams({ message: content, access_token: token }),
  });
  const postData = await postRes.json();
  if (!postRes.ok) throw new Error(postData.error?.message || 'Facebook post failed');
  return { id: postData.id, platform: 'facebook' };
}

async function publishInstagram(content, imageUrl) {
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!imageUrl) throw new Error('Instagram requires an image');

  const containerRes = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(content)}&access_token=${token}`,
    { method: 'POST' }
  );
  const containerData = await containerRes.json();
  if (!containerRes.ok) throw new Error(containerData.error?.message || 'Instagram container failed');

  await new Promise(resolve => setTimeout(resolve, 5000));

  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/media_publish?creation_id=${containerData.id}&access_token=${token}`,
    { method: 'POST' }
  );
  const publishData = await publishRes.json();
  if (!publishRes.ok) throw new Error(publishData.error?.message || 'Instagram publish failed');
  return { id: publishData.id, platform: 'instagram' };
}

async function publishLinkedIn(content, imageUrl) {
  const personId = process.env.LINKEDIN_PERSON_ID;
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const author = `urn:li:person:${personId}`;
  let shareMedia = [];

  if (imageUrl) {
    const regRes = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
          owner: author,
          serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
        },
      }),
    });
    const regData = await regRes.json();
    const uploadUrl = regData.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
    const assetUrn = regData.value?.asset;

    if (uploadUrl && assetUrn) {
      const imgRes = await fetch(imageUrl);
      const imgBuffer = await imgRes.arrayBuffer();
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` },
        body: imgBuffer,
      });
      shareMedia = [{ status: 'READY', media: assetUrn }];
    }
  }

  const postRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: content },
          shareMediaCategory: shareMedia.length ? 'IMAGE' : 'NONE',
          ...(shareMedia.length && { media: shareMedia }),
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  });
  const postData = await postRes.json();
  if (!postRes.ok) throw new Error(JSON.stringify(postData) || 'LinkedIn post failed');
  return { id: postData.id, platform: 'linkedin' };
}

async function publishGoogle(content, imageUrl, record = {}) {
  const locationId = process.env.GOOGLE_LOCATION_ID;
  const token = process.env.GOOGLE_ACCESS_TOKEN;

  const body = {
    languageCode: 'fr',
    summary: nettoyerPostGoogle(content), // Google refuse téléphone, liens et emails dans le texte
    // « Appeler » utilise le numéro de la fiche Google ; « En savoir plus » renvoie vers le site
    callToAction: record.googleBouton === 'CALL' ? { actionType: 'CALL' } : { actionType: 'LEARN_MORE', url: 'https://www.toanimmo-lyon.fr' },
  };
  if (imageUrl) body.media = [{ mediaFormat: 'PHOTO', sourceUrl: imageUrl }];

  const postRes = await fetch(`https://mybusiness.googleapis.com/v4/${locationId}/localPosts`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const postData = await postRes.json();
  if (!postRes.ok) throw new Error(postData.error?.message || 'Google Business post failed');
  return { id: postData.name, platform: 'google' };
}

const PUBLISHERS = { facebook: publishFacebook, instagram: publishInstagram, linkedin: publishLinkedIn, google: publishGoogle };

// ── HTML pages ───────────────────────────────────────────────────────────────

const page = (emoji, title, msg) => `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><title>${title}</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f3f4f6;margin:0;}
.box{background:#fff;border-radius:16px;padding:48px 40px;text-align:center;max-width:400px;box-shadow:0 2px 12px rgba(0,0,0,.08);}
h1{color:#1A2E4A;font-size:22px;margin:0 0 8px;} p{color:#6b7280;font-size:14px;}</style>
</head><body><div class="box"><div style="font-size:48px;margin-bottom:16px">${emoji}</div><h1>${title}</h1><p>${msg}</p></div></body></html>`;

// Page de confirmation : le lien de l'e-mail (GET) n'agit jamais directement.
// Les scanners de liens des messageries (Gmail, Outlook Safe Links…) ouvrent les liens
// en GET ; seul le clic sur le bouton (POST) publie ou rejette.
const confirmPage = (token, platform, action) => {
  const approve = action === 'approve';
  const qs = new URLSearchParams({ token, platform, action }).toString();
  const label = approve ? '✅ Confirmer la publication' : '❌ Confirmer le rejet';
  const msg = approve ? `Publier le contenu ${platform} maintenant ?` : `Rejeter le contenu ${platform} ?`;
  return page(approve ? '📤' : '🗑️', 'Confirmation', `${msg}</p>
<form method="POST" action="/api/approve?${qs}" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Traitement…';">
<button type="submit" style="margin-top:16px;padding:12px 26px;background:#1A2E4A;color:#fff;border:0;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer;">${label}</button>
</form><p>`);
};

const TTL = 172800; // 48h, comme l'enregistrement de validation

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const { token, platform, action } = req.query;

  if (!token || !platform || !action) return res.status(400).send(page('⚠️', 'Erreur', 'Paramètres manquants.'));
  if (action !== 'approve' && action !== 'reject') return res.status(400).send(page('⚠️', 'Erreur', 'Action inconnue.'));
  if (!PUBLISHERS[platform]) return res.status(400).send(page('⚠️', 'Erreur', 'Plateforme inconnue.'));

  const record = await redis.get(`validation:${token}`);
  if (!record) return res.status(404).send(page('⚠️', 'Erreur', 'Lien expiré ou invalide (48h max).'));

  const lockKey = `validation-lock:${token}:${platform}`;
  const dejaTraite = () => res.status(200).send(page('⚠️', 'Déjà traité', `Ce post ${platform} a déjà été traité.`));

  if (record.status?.[platform] !== 'pending' || await redis.get(lockKey)) return dejaTraite();

  if (req.method === 'GET') return res.status(200).send(confirmPage(token, platform, action));
  if (req.method !== 'POST') return res.status(405).send(page('⚠️', 'Erreur', 'Méthode non autorisée.'));

  // Verrou atomique : une seule requête peut traiter ce post, même en cas de double clic.
  // Le verrou n'est jamais retiré après un succès, donc aucune republication possible.
  const acquired = await redis.set(lockKey, 'processing', { nx: true, ex: TTL });
  if (!acquired) return dejaTraite();

  const saveStatus = async (status) => {
    // Relire l'enregistrement pour ne pas écraser le statut des autres plateformes
    const fresh = (await redis.get(`validation:${token}`)) || record;
    fresh.status = { ...fresh.status, [platform]: status };
    await redis.set(`validation:${token}`, fresh, { ex: TTL });
    await redis.set(lockKey, status, { ex: TTL });
  };

  if (action === 'reject') {
    await saveStatus('rejected');
    return res.status(200).send(page('❌', 'Contenu rejeté', `Le post ${platform} ne sera pas publié.`));
  }

  try {
    await PUBLISHERS[platform](record.content[platform], record.images[platform], record);
  } catch (err) {
    console.error(`publish ${platform} error:`, err);
    await redis.del(lockKey); // échec : on autorise une nouvelle tentative
    return res.status(500).send(page('⚠️', 'Erreur de publication', `${platform} : ${err.message}`));
  }

  await saveStatus('published');
  return res.status(200).send(page('✅', 'Publié avec succès', `Le contenu ${platform} a été publié.`));
}
