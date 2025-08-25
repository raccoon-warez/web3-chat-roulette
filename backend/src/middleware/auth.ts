import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { redisClient } from '../utils/redis';
import crypto from 'crypto';

// Extend the Request type to include user data
export interface AuthRequest extends Request {
  user?: {
    address: string;
    chainId: number;
    sessionId?: string;
    tokenType?: 'access' | 'refresh';
    iat?: number;
    exp?: number;
  };
}

// JWT payload interface
interface JWTPayload {
  address: string;
  chainId: number;
  sessionId: string;
  tokenType: 'access' | 'refresh';
  iat: number;
  exp: number;
  jti: string; // JWT ID for token blacklisting
}

// Generate secure JWT secret if not provided
const getJWTSecret = (type: 'access' | 'refresh' = 'access'): string => {
  const secret = type === 'access' 
    ? process.env.JWT_ACCESS_SECRET 
    : process.env.JWT_REFRESH_SECRET;
    
  if (!secret) {
    console.warn(`JWT ${type} secret not found in environment variables, using fallback`);
    return process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
  }
  
  return secret;
};

// Check if token is blacklisted
const isTokenBlacklisted = async (jti: string): Promise<boolean> => {
  try {
    const blacklisted = await redisClient.get(`blacklist:${jti}`);
    return blacklisted === 'true';
  } catch (error) {
    console.error('Error checking token blacklist:', error);
    return false; // Fail open for Redis errors
  }
};

// Add token to blacklist
export const blacklistToken = async (jti: string, expiresIn: number): Promise<void> => {
  try {
    await redisClient.setEx(`blacklist:${jti}`, expiresIn, 'true');
  } catch (error) {
    console.error('Error blacklisting token:', error);
  }
};

// Generate access token
export const generateAccessToken = (payload: Omit<JWTPayload, 'tokenType' | 'iat' | 'exp' | 'jti'>): string => {
  const jti = crypto.randomUUID();
  const tokenPayload = {
    ...payload,
    tokenType: 'access' as const,
    jti
  };
  
  return jwt.sign(tokenPayload, getJWTSecret('access'), {
    expiresIn: '15m', // Short-lived access tokens
    issuer: 'web3-chat-roulette',
    audience: 'web3-chat-users',
    subject: payload.address
  });
};

// Generate refresh token
export const generateRefreshToken = (payload: Omit<JWTPayload, 'tokenType' | 'iat' | 'exp' | 'jti'>): string => {
  const jti = crypto.randomUUID();
  const tokenPayload = {
    ...payload,
    tokenType: 'refresh' as const,
    jti
  };
  
  return jwt.sign(tokenPayload, getJWTSecret('refresh'), {
    expiresIn: '7d', // Longer-lived refresh tokens
    issuer: 'web3-chat-roulette',
    audience: 'web3-chat-users',
    subject: payload.address
  });
};

// Store refresh token in Redis
export const storeRefreshToken = async (address: string, sessionId: string, refreshToken: string): Promise<void> => {
  try {
    const key = `refresh_token:${address}:${sessionId}`;
    await redisClient.setEx(key, 7 * 24 * 60 * 60, refreshToken); // 7 days
  } catch (error) {
    console.error('Error storing refresh token:', error);
  }
};

// Validate refresh token from Redis
export const validateRefreshToken = async (address: string, sessionId: string, token: string): Promise<boolean> => {
  try {
    const key = `refresh_token:${address}:${sessionId}`;
    const storedToken = await redisClient.get(key);
    return storedToken === token;
  } catch (error) {
    console.error('Error validating refresh token:', error);
    return false;
  }
};

// Remove refresh token from Redis
export const removeRefreshToken = async (address: string, sessionId: string): Promise<void> => {
  try {
    const key = `refresh_token:${address}:${sessionId}`;
    await redisClient.del(key);
  } catch (error) {
    console.error('Error removing refresh token:', error);
  }
};

// Enhanced authentication middleware
const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction): Promise<any> => {
  try {
    // Get token from cookie or Authorization header
    let token = req.cookies?.accessToken;
    
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Access token required',
        code: 'NO_TOKEN'
      });
    }
    
    // Verify and decode token
    const decoded = jwt.verify(token, getJWTSecret('access'), {
      issuer: 'web3-chat-roulette',
      audience: 'web3-chat-users'
    }) as JWTPayload;
    
    // Check if token type is correct
    if (decoded.tokenType !== 'access') {
      return res.status(401).json({ 
        error: 'Invalid token type',
        code: 'WRONG_TOKEN_TYPE'
      });
    }
    
    // Check if token is blacklisted
    if (await isTokenBlacklisted(decoded.jti)) {
      return res.status(401).json({ 
        error: 'Token has been revoked',
        code: 'TOKEN_BLACKLISTED'
      });
    }
    
    // Check token freshness (optional: reject tokens older than X minutes)
    const tokenAge = Date.now() / 1000 - decoded.iat;
    if (tokenAge > 24 * 60 * 60) { // 24 hours
      return res.status(401).json({ 
        error: 'Token too old, please refresh',
        code: 'TOKEN_TOO_OLD'
      });
    }
    
    // Attach user data to request
    req.user = {
      address: decoded.address,
      chainId: decoded.chainId,
      sessionId: decoded.sessionId,
      tokenType: decoded.tokenType,
      iat: decoded.iat,
      exp: decoded.exp
    };
    
    // Update last activity timestamp
    await updateLastActivity(decoded.address, decoded.sessionId);
    
    next();
  } catch (error) {
    console.error('JWT verification error:', error);
    
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ 
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
        expiredAt: error.expiredAt
      });
    } else if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ 
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    } else if (error instanceof jwt.NotBeforeError) {
      return res.status(401).json({ 
        error: 'Token not active yet',
        code: 'TOKEN_NOT_ACTIVE'
      });
    }
    
    return res.status(401).json({ 
      error: 'Authentication failed',
      code: 'AUTH_FAILED'
    });
  }
};

// Optional authentication middleware (doesn't fail if no token)
export const optionalAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.cookies?.accessToken || 
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null);
  
  if (!token) {
    return next();
  }
  
  try {
    const decoded = jwt.verify(token, getJWTSecret('access'), {
      issuer: 'web3-chat-roulette',
      audience: 'web3-chat-users'
    }) as JWTPayload;
    
    if (decoded.tokenType === 'access' && !(await isTokenBlacklisted(decoded.jti))) {
      req.user = {
        address: decoded.address,
        chainId: decoded.chainId,
        sessionId: decoded.sessionId,
        tokenType: decoded.tokenType,
        iat: decoded.iat,
        exp: decoded.exp
      };
      
      await updateLastActivity(decoded.address, decoded.sessionId);
    }
  } catch (error) {
    // Silently ignore authentication errors for optional auth
    console.warn('Optional auth failed:', error instanceof Error ? error.message : error);
  }
  
  next();
};

// Refresh token authentication middleware
export const authenticateRefreshToken = async (req: AuthRequest, res: Response, next: NextFunction): Promise<any> => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({ 
        error: 'Refresh token required',
        code: 'NO_REFRESH_TOKEN'
      });
    }
    
    const decoded = jwt.verify(refreshToken, getJWTSecret('refresh'), {
      issuer: 'web3-chat-roulette',
      audience: 'web3-chat-users'
    }) as JWTPayload;
    
    if (decoded.tokenType !== 'refresh') {
      return res.status(401).json({ 
        error: 'Invalid token type',
        code: 'WRONG_TOKEN_TYPE'
      });
    }
    
    // Validate refresh token exists in Redis
    const isValid = await validateRefreshToken(decoded.address, decoded.sessionId, refreshToken);
    if (!isValid) {
      return res.status(401).json({ 
        error: 'Invalid refresh token',
        code: 'INVALID_REFRESH_TOKEN'
      });
    }
    
    // Check if token is blacklisted
    if (await isTokenBlacklisted(decoded.jti)) {
      return res.status(401).json({ 
        error: 'Refresh token has been revoked',
        code: 'REFRESH_TOKEN_BLACKLISTED'
      });
    }
    
    req.user = {
      address: decoded.address,
      chainId: decoded.chainId,
      sessionId: decoded.sessionId,
      tokenType: decoded.tokenType,
      iat: decoded.iat,
      exp: decoded.exp
    };
    
    next();
  } catch (error) {
    console.error('Refresh token verification error:', error);
    
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ 
        error: 'Refresh token expired',
        code: 'REFRESH_TOKEN_EXPIRED'
      });
    }
    
    return res.status(401).json({ 
      error: 'Invalid refresh token',
      code: 'INVALID_REFRESH_TOKEN'
    });
  }
};

// Update last activity timestamp
const updateLastActivity = async (address: string, sessionId: string): Promise<void> => {
  try {
    const key = `last_activity:${address}:${sessionId}`;
    await redisClient.setEx(key, 24 * 60 * 60, Date.now().toString()); // 24 hours
  } catch (error) {
    console.error('Error updating last activity:', error);
  }
};

// Get last activity timestamp
export const getLastActivity = async (address: string, sessionId: string): Promise<number | null> => {
  try {
    const key = `last_activity:${address}:${sessionId}`;
    const timestamp = await redisClient.get(key);
    return timestamp ? parseInt(timestamp, 10) : null;
  } catch (error) {
    console.error('Error getting last activity:', error);
    return null;
  }
};

// WebSocket authentication
export const authenticateWebSocket = async (token: string): Promise<JWTPayload | null> => {
  try {
    const decoded = jwt.verify(token, getJWTSecret('access'), {
      issuer: 'web3-chat-roulette',
      audience: 'web3-chat-users'
    }) as JWTPayload;
    
    if (decoded.tokenType !== 'access' || await isTokenBlacklisted(decoded.jti)) {
      return null;
    }
    
    await updateLastActivity(decoded.address, decoded.sessionId);
    return decoded;
  } catch (error) {
    console.error('WebSocket authentication error:', error);
    return null;
  }
};

export default authenticateToken;
