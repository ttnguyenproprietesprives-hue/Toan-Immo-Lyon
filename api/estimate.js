export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const prompt = body?.prompt;
    if (!prompt) return res.status(400).json({ error: 'Prompt manquant' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Clé API manquante' });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data });

    const text = (data.content || []).map(b => b.text || '').join('');
    
    // Extraire le JSON même s'il y a du texte autour
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'Pas de JSON dans la réponse', raw: text });
    
    const parsed = JSON.parse(match[0]);
    res.status(200).json(parsed);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
