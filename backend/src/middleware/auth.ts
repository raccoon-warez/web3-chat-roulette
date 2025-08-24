import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Extend the Request type to include user data
interface AuthRequest extends Request {
  user?: {
    address: string;
    chainId: number;
  };
}

const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  // Get token from cookie
  const token = req.cookies.token;
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as {
      address: string;
      chainId: number;
    };
    
    // Attach user data to request
    req.user = decoded;
    
    next();
  } catch (error) {
    console.error('JWT verification error:', error);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

export default authenticateToken;
