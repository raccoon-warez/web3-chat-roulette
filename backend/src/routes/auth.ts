import express from 'express';
import { SiweMessage } from 'siwe';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const router = express.Router();

// In-memory store for nonces (in production, use Redis)
const nonces: Record<string, { nonce: string; expiresAt: Date }> = {};

// Generate a random nonce
const generateNonce = () => {
  return crypto.randomBytes(16).toString('hex');
};

// GET /auth/siwe/nonce - Generate a nonce for SIWE
router.get('/siwe/nonce', (req, res) => {
  const nonce = generateNonce();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
  
  // In production, store in Redis with TTL
  nonces[req.ip] = { nonce, expiresAt };
  
  res.json({ nonce });
});

// POST /auth/siwe/verify - Verify SIWE signature
router.post('/siwe/verify', async (req, res) => {
  try {
    const { message, signature } = req.body;
    
    // Parse the SIWE message
    const siweMessage = new SiweMessage(message);
    
    // Verify the signature
    const fields = await siweMessage.validate(signature);
    
    // Check if nonce is valid
    const storedNonce = nonces[req.ip];
    if (!storedNonce || storedNonce.nonce !== fields.nonce) {
      return res.status(400).json({ error: 'Invalid nonce' });
    }
    
    // Check if nonce has expired
    if (storedNonce.expiresAt < new Date()) {
      delete nonces[req.ip];
      return res.status(400).json({ error: 'Nonce expired' });
    }
    
    // Clean up used nonce
    delete nonces[req.ip];
    
    // Create JWT token
    const token = jwt.sign(
      { 
        address: fields.address,
        chainId: fields.chainId
      },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '1h' }
    );
    
    // Set HttpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 1000 // 1 hour
    });
    
    res.json({ 
      address: fields.address,
      chainId: fields.chainId,
      issuedAt: fields.issuedAt
    });
  } catch (error) {
    console.error('SIWE verification error:', error);
    res.status(400).json({ error: 'Invalid signature' });
  }
});

export default router;
