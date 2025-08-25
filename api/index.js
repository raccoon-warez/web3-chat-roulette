// Vercel serverless function entry point
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

// Import backend app (we'll need to adapt this)
const backendApp = require('../backend/src/index.ts');

module.exports = async (req, res) => {
  try {
    // Handle API routes
    if (req.url.startsWith('/api/')) {
      return await backendApp(req, res);
    }
    
    // For non-API routes, return 404
    res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('Serverless function error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};