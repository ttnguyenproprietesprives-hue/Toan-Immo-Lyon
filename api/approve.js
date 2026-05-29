import { kv } from '@vercel/kv';

export const config = { runtime: 'nodejs' };

// ── Platform publishers ──────────────────────────────────────────────────────

async function publishFacebook(content, imageUrl) {
  const pageId = process.env.META_PAGE_ID;
  const token = process.env.META_PAGE_ACCESS_TOKEN;

  // Upload photo then publish post with it
  if (imageUrl) {
    const photoRes = await fetch(
      `https://graph.facebook.com/v19.0/${pageId}/photos`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: imageUrl,
          caption: content,
          access_token: token,
        }),
      }
    );
    const photoData = await photoRes.json();
    if (!photoRes.ok) throw new Error(photoData.error?.message || 'Facebook photo upload failed');
    return { id: photoData.id, platform: 'facebook' };
  }

  const postRes = await fetch(
    `https://graph.facebook.com/v19.0/${pageId}/feed`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: content, access_token: token }),
    }
  );
  const postData = await postRes.json();
  if (!postRes.ok) throw new Error(postData.error?.message || 'Facebook post failed');
  return { id: postData.id, platform: 'facebook' };
}

async function publishInstagram(content, imageUrl) {
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  const token = process.env.META_PAGE_ACCESS_TOKEN;

  if (!imageUrl) throw new Error('Instagram requires an image');

  // Step 1: Create media container
  const containerRes = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: content,
        access_token: token,
      }),
    }
  );
  const containerData = await containerRes.json();
  if (!containerRes.ok) throw new Error(containerData.error?.message || 'Instagram container failed');

  // Step 2: Publish container
  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerData.id,
        access_token: token,
      }),
    }
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
    // Step 1: Register image upload
    const regRes = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
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
      // Step 2: Upload image binary
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

  const body = {
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
  };

  const postRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const postData = await postRes.json();
  if (!postRes.ok) throw new Error(JSON.stringify(postData) || 'LinkedIn post failed');
  return { id: postData.id, platform: 'linkedin' };
}

async function publishGoogle(content, imageUrl) {
  const locationId = process.env.GOOGLE_LOCATION_ID; // accounts/xxx/locations/yyy
  const token = process.env.GOOGLE_ACCESS_TOKEN;

  const body = {
    languageCode: 'fr',
    summary: content,
    callToAction: {
      actionType: 'LEARN_MORE',
      url: 'https://www.toanimmo-lyon.fr',
    },
  };

  if (imageUrl) {
    body.media = [{ mediaFormat: 'PHOTO', sourceUrl: imageUrl }];
  }

  const postRes = await fetch(
    `https://mybusiness.googleapis.com/v4/${locationId}/localPosts`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  const postData = await postRes.json();
  if (!postRes.ok) throw new Error(postData.error?.message || 'Google Business post failed');
  return { id: postData.name, platform: 'google' };
}

const PUBLISHERS = { facebook: publishFacebook, instagram: publishInstagram, linkedin: publishLinkedIn, google: publishGoogle };

// ── HTML response pages ──────────────────────────────────────────────────────

function successPage(platform) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><title>Publié</title>
  <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f3f4f6;margin:0;}
  .box{background:#fff;border-radius:16px;padding:48px 40px;text-align:center;max-width:400px;box-shadow:0 2px 12px rgba(0,0,0,.08);}
  h1{color:#1A2E4A;font-size:22px;margin:0 0 8px;} p{color:#6b7280;font-size:14px;}</style>
  </head><body><div class="box"><div style="font-size:48px;margin-bottom:16px">✅</div>
  <h1>Publié avec succès</h1><p>Le contenu <strong>${platform}</strong> a été publié.</p></div></body></html>`;
}

function rejectPage(platform) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><title>Rejeté</title>
  <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f3f4f6;margin:0;}
  .box{background:#fff;border-radius:16px;padding:48px 40px;text-align:center;max-width:400px;box-shadow:0 2px 12px rgba(0,0,0,.08);}
  h1{color:#374151;font-size:22px;margin:0 0 8px;} p{color:#6b7280;font-size:14px;}</style>
  </head><body><div class="box"><div style="font-size:48px;margin-bottom:16px">❌</div>
  <h1>Contenu rejeté</h1><p>Le post <strong>${platform}</strong> ne sera pas publié.</p></div></body></html>`;
}

function errorPage(msg) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><title>Erreur</title>
  <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f3f4f6;margin:0;}
  .box{background:#fff;border-radius:16px;padding:48px 40px;text-align:center;max-width:400px;box-shadow:0 2px 12px rgba(0,0,0,.08);}
  h1{color:#c0392b;font-size:22px;margin:0 0 8px;} p{color:#6b7280;font-size:14px;}</style>
  </head><body><div class="box"><div style="font-size:48px;margin-bottom:16px">⚠️</div>
  <h1>Erreur</h1><p>${msg}</p></div></body></html>`;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const { token, platform, action } = req.query;

  if (!token || !platform || !action) {
    return res.status(400).send(errorPage('Paramètres manquants.'));
  }

  const record = await kv.get(`validation:${token}`);
  if (!record) {
    return res.status(404).send(errorPage('Lien expiré ou invalide (48h max).'));
  }

  if (record.status[platform] !== 'pending') {
    return res.status(200).send(errorPage(`Ce post ${platform} a déjà été traité.`));
  }

  if (action === 'reject') {
    record.status[platform] = 'rejected';
    await kv.set(`validation:${token}`, record, { ex: 172800 });
    return res.status(200).send(rejectPage(platform));
  }

  if (action === 'approve') {
    const publisher = PUBLISHERS[platform];
    if (!publisher) return res.status(400).send(errorPage('Plateforme inconnue.'));

    try {
      await publisher(record.content[platform], record.images[platform]);
      record.status[platform] = 'published';
      await kv.set(`validation:${token}`, record, { ex: 172800 });
      return res.status(200).send(successPage(platform));
    } catch (err) {
      console.error(`publish ${platform} error:`, err);
      return res.status(500).send(errorPage(`Erreur de publication ${platform} : ${err.message}`));
    }
  }

  return res.status(400).send(errorPage('Action inconnue.'));
}
