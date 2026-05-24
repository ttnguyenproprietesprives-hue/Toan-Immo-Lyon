export default async function handler(req, res) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const REPO = 'ttnguyenproprietesprives-hue/Toan-Immo-Lyon';

  if (req.method === 'GET') {
    const { path } = req.query;
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
      });
      if (!r.ok) return res.status(404).json({ error: 'not found' });
      const data = await r.json();
      return res.status(200).json({ sha: data.sha });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    const { path, content, sha, message } = req.body;
    try {
      const body = { message: message || 'Blog: nouvel article', content };
      if (sha) body.sha = sha;

      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!r.ok) {
        const err = await r.json();
        return res.status(r.status).json({ error: err.message });
      }

      const data = await r.json();
      return res.status(200).json({ ok: true, url: data.content?.html_url });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).end();
}
