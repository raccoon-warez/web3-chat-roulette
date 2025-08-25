import express from 'express';
import { SiweMessage } from 'siwe';
import crypto from 'crypto';
import { 
  generateAccessToken, 
  generateRefreshToken, 
  storeRefreshToken,
  removeRefreshToken,
  authenticateRefreshToken,
  blacklistToken,
  AuthRequest
} from '../middleware/auth';
import { redisClient } from '../utils/redis';
import { authRateLimit, authBruteForce } from '../middleware/rateLimiter';
import { 
  validateSiweNonceRequest, 
  validateSiweVerification,
  sanitizeAndValidateInput,
  handleValidationErrors
} from '../middleware/validation';

const router = express.Router();

// Generate a cryptographically secure nonce
const generateNonce = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

// Store nonce in Redis with TTL
const storeNonce = async (clientIp: string, nonce: string): Promise<void> => {
  const key = `nonce:${clientIp}`;
  await redisClient.setEx(key, 5 * 60, nonce); // 5 minutes TTL
};

// Retrieve and remove nonce from Redis
const consumeNonce = async (clientIp: string, providedNonce: string): Promise<boolean> => {
  const key = `nonce:${clientIp}`;
  const storedNonce = await redisClient.get(key);
  
  if (storedNonce && storedNonce === providedNonce) {
    await redisClient.del(key); // Remove nonce after use
    return true;
  }
  
  return false;
};

// GET /auth/siwe/nonce - Generate a nonce for SIWE
router.get('/siwe/nonce', 
  authRateLimit,
  validateSiweNonceRequest,
  async (req, res) => {
    try {
      const nonce = generateNonce();
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      
      await storeNonce(clientIp, nonce);
      
      // Add security headers
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      
      res.json({ 
        nonce,
        expiresIn: 5 * 60, // 5 minutes in seconds
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Error generating nonce:', error);
      res.status(500).json({ 
        error: 'Failed to generate nonce',
        code: 'NONCE_GENERATION_FAILED'
      });
    }
  }
);

// POST /auth/siwe/verify - Verify SIWE signature
router.post('/siwe/verify',
  authRateLimit,
  authBruteForce.prevent,
  validateSiweVerification,
  sanitizeAndValidateInput,
  handleValidationErrors,
  async (req: express.Request, res: express.Response): Promise<any> => {
    try {
      const { message, signature } = req.body;
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      
      // Parse the SIWE message
      const siweMessage = new SiweMessage(message);
      
      // Additional SIWE message validation
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
      
      // Check message timestamp freshness
      if (siweMessage.issuedAt && new Date(siweMessage.issuedAt) < fiveMinutesAgo) {
        return res.status(400).json({ 
          error: 'Message too old',
          code: 'MESSAGE_TOO_OLD'
        });
      }
      
      if (siweMessage.notBefore && new Date(siweMessage.notBefore) > now) {
        return res.status(400).json({ 
          error: 'Message not yet valid',
          code: 'MESSAGE_NOT_VALID_YET'
        });
      }
      
      if (siweMessage.expirationTime && new Date(siweMessage.expirationTime) < now) {
        return res.status(400).json({ 
          error: 'Message expired',
          code: 'MESSAGE_EXPIRED'
        });
      }
      
      // Verify the signature
      const fields = await siweMessage.verify({ signature });
      
      // Verify nonce
      const nonceValid = await consumeNonce(clientIp, fields.data.nonce);
      if (!nonceValid) {
        return res.status(400).json({ 
          error: 'Invalid or expired nonce',
          code: 'INVALID_NONCE'
        });
      }
      
      // Generate session ID
      const sessionId = crypto.randomUUID();
      
      // Generate tokens
      const accessToken = generateAccessToken({
        address: fields.data.address,
        chainId: fields.data.chainId || 1,
        sessionId
      });
      
      const refreshToken = generateRefreshToken({
        address: fields.data.address,
        chainId: fields.data.chainId || 1,
        sessionId
      });
      
      // Store refresh token in Redis
      await storeRefreshToken(fields.data.address, sessionId, refreshToken);
      
      // Set secure cookies
      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
        domain: isProduction ? process.env.COOKIE_DOMAIN : undefined
      };
      
      res.cookie('accessToken', accessToken, {
        ...cookieOptions,
        maxAge: 15 * 60 * 1000 // 15 minutes
      });
      
      res.cookie('refreshToken', refreshToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
      
      // Log successful authentication
      console.log(`Successful authentication for ${fields.data.address} from ${clientIp}`);
      
      res.json({ 
        address: fields.data.address,
        chainId: fields.data.chainId || 1,
        sessionId,
        expiresIn: 15 * 60, // Access token expiry in seconds
        issuedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('SIWE verification error:', error);
      
      // Handle specific verification errors
      if (error instanceof Error && error.message.includes('Invalid signature')) {
        return res.status(400).json({ 
          error: 'Invalid signature',
          code: 'INVALID_SIGNATURE'
        });
      }
      
      return res.status(400).json({ 
        error: 'Authentication failed',
        code: 'AUTH_FAILED'
      });
    }
  }
);

// POST /auth/refresh - Refresh access token using refresh token
router.post('/refresh',
  authRateLimit,
  authenticateRefreshToken,
  async (req: AuthRequest, res): Promise<any> => {
    try {
      if (!req.user) {
        return res.status(401).json({ 
          error: 'Invalid refresh token',
          code: 'INVALID_REFRESH_TOKEN'
        });
      }
      
      // Generate new access token
      const newAccessToken = generateAccessToken({
        address: req.user.address,
        chainId: req.user.chainId,
        sessionId: req.user.sessionId!
      });
      
      // Set new access token cookie
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie('accessToken', newAccessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/',
        domain: isProduction ? process.env.COOKIE_DOMAIN : undefined,
        maxAge: 15 * 60 * 1000 // 15 minutes
      });
      
      res.json({
        message: 'Token refreshed successfully',
        expiresIn: 15 * 60,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Token refresh error:', error);
      res.status(500).json({ 
        error: 'Failed to refresh token',
        code: 'REFRESH_FAILED'
      });
    }
  }
);

// POST /auth/logout - Logout user and invalidate tokens
router.post('/logout',
  async (req: AuthRequest, res): Promise<any> => {
    try {
      const refreshToken = req.cookies?.refreshToken;
      const accessToken = req.cookies?.accessToken;
      
      // Extract user info from access token if available
      if (accessToken) {
        try {
          const jwt = require('jsonwebtoken');
          const decoded = jwt.decode(accessToken) as any;
          
          if (decoded && decoded.address && decoded.sessionId) {
            // Remove refresh token from Redis
            await removeRefreshToken(decoded.address, decoded.sessionId);
            
            // Add tokens to blacklist
            if (decoded.jti) {
              const ttl = Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
              await blacklistToken(decoded.jti, ttl);
            }
          }
        } catch (error) {
          console.error('Error processing logout token:', error);
        }
      }
      
      // Clear cookies
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict' as const,
        path: '/',
        domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined
      };
      
      res.clearCookie('accessToken', cookieOptions);
      res.clearCookie('refreshToken', cookieOptions);
      
      res.json({ 
        message: 'Logged out successfully',
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ 
        error: 'Failed to logout',
        code: 'LOGOUT_FAILED'
      });
    }
  }
);

// POST /auth/logout-all - Logout from all sessions
router.post('/logout-all',
  async (req: AuthRequest, res): Promise<any> => {
    try {
      const accessToken = req.cookies?.accessToken;
      
      if (accessToken) {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.decode(accessToken) as any;
        
        if (decoded && decoded.address) {
          // Remove all refresh tokens for this address
          const pattern = `refresh_token:${decoded.address}:*`;
          const keys = await redisClient.keys(pattern);
          
          if (keys.length > 0) {
            await redisClient.del(keys);
          }
          
          // Note: In a production system, you might want to maintain a 
          // separate blacklist for all tokens issued to this address
        }
      }
      
      // Clear cookies
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict' as const,
        path: '/',
        domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined
      };
      
      res.clearCookie('accessToken', cookieOptions);
      res.clearCookie('refreshToken', cookieOptions);
      
      res.json({ 
        message: 'Logged out from all sessions',
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Logout all error:', error);
      res.status(500).json({ 
        error: 'Failed to logout from all sessions',
        code: 'LOGOUT_ALL_FAILED'
      });
    }
  }
);

// GET /auth/me - Get current user info (requires authentication)
router.get('/me',
  async (req: AuthRequest, res): Promise<any> => {
    // This endpoint will use the general authentication middleware applied at the app level
    res.json({
      address: req.user?.address,
      chainId: req.user?.chainId,
      sessionId: req.user?.sessionId,
      tokenType: req.user?.tokenType,
      issuedAt: req.user?.iat ? new Date(req.user.iat * 1000).toISOString() : undefined,
      expiresAt: req.user?.exp ? new Date(req.user.exp * 1000).toISOString() : undefined
    });
  }
);

export default router;
