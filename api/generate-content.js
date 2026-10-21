import { isAdmin } from './_auth.js';
import { erreurIA } from './_util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const prompt = body.prompt;

    if (!prompt) return res.status(400).json({ error: 'prompt manquant' });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic', response.status, data);
      return res.status(502).json({ error: erreurIA(response.status, data) });
    }
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Le service d'IA n'a pas répondu. Réessayez dans quelques minutes." });
  }
}
