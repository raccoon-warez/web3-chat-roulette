// Serverless function for SIWE nonce generation
const { v4: uuidv4 } = require('uuid');

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const nonce = uuidv4();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // In production, store this in Redis/Database
    // For now, return directly
    res.json({
      nonce,
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error('Nonce generation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};