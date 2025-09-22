import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { path } = req.query;
  const apiPath = Array.isArray(path) ? path.join('/') : path;
  
  // Get the full URL path
  const fullPath = `/v1/${apiPath}`;
  
  try {
    const response = await fetch(`https://api.heygen.com${fullPath}`, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.VITE_HEYGEN_API_KEY || '',
        ...(req.headers as Record<string, string>),
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });

    const data = await response.json();
    
    res.status(response.status).json(data);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
