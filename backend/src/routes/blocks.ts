import express from 'express';
import authenticateToken, { AuthRequest } from '../middleware/auth';
import { generalRateLimit, createWalletRateLimit } from '../middleware/rateLimiter';
import { 
  validateBlockUser,
  validateUnblockUser,
  sanitizeAndValidateInput,
  handleValidationErrors
} from '../middleware/validation';
import { redisClient } from '../utils/redis';

const router = express.Router();

// POST /blocks - Block a user
router.post('/',
  generalRateLimit,
  createWalletRateLimit(10, 60), // Max 10 blocks per hour per wallet
  authenticateToken,
  validateBlockUser,
  sanitizeAndValidateInput,
  handleValidationErrors,
  async (req: AuthRequest, res: express.Response): Promise<any> => {
    try {
      const { targetAddr, reason } = req.body;
      const blockerAddr = req.user!.address;
      
      // Prevent self-blocking
      if (targetAddr.toLowerCase() === blockerAddr.toLowerCase()) {
        return res.status(400).json({
          error: 'Cannot block yourself',
          code: 'SELF_BLOCK_NOT_ALLOWED'
        });
      }
      
      // Check if already blocked
      const blockKey = `block:${blockerAddr.toLowerCase()}:${targetAddr.toLowerCase()}`;
      const existingBlock = await redisClient.get(blockKey);
      
      if (existingBlock) {
        return res.status(409).json({
          error: 'User is already blocked',
          code: 'USER_ALREADY_BLOCKED'
        });
      }
      
      // Create block record
      const blockRecord = {
        blockerAddr: blockerAddr.toLowerCase(),
        targetAddr: targetAddr.toLowerCase(),
        reason: reason || 'No reason provided',
        timestamp: new Date().toISOString(),
        ip: req.ip || req.socket.remoteAddress
      };
      
      // Store block in Redis (in production, this would go to a database)
      await redisClient.set(blockKey, JSON.stringify(blockRecord));
      
      // Add to blocker's block list
      const blockListKey = `blocklist:${blockerAddr.toLowerCase()}`;
      await redisClient.sAdd(blockListKey, targetAddr.toLowerCase());
      
      // Set expiry for cleanup (optional - blocks could be permanent)
      await redisClient.expire(blockListKey, 365 * 24 * 60 * 60); // 1 year
      
      console.log('User blocked:', {
        blocker: blockerAddr,
        target: targetAddr,
        reason: blockRecord.reason,
        timestamp: blockRecord.timestamp
      });
      
      res.status(201).json({
        message: 'User blocked successfully',
        targetAddr: targetAddr.toLowerCase(),
        timestamp: blockRecord.timestamp
      });
    } catch (error) {
      console.error('Error blocking user:', error);
      res.status(500).json({
        error: 'Failed to block user',
        code: 'BLOCK_USER_FAILED'
      });
    }
  }
);

// DELETE /blocks/:address - Unblock a user
router.delete('/:address',
  generalRateLimit,
  authenticateToken,
  validateUnblockUser,
  async (req: AuthRequest, res: express.Response): Promise<any> => {
    try {
      const targetAddr = req.params.address.toLowerCase();
      const blockerAddr = req.user!.address.toLowerCase();
      
      // Check if actually blocked
      const blockKey = `block:${blockerAddr}:${targetAddr}`;
      const existingBlock = await redisClient.get(blockKey);
      
      if (!existingBlock) {
        return res.status(404).json({
          error: 'User is not blocked',
          code: 'USER_NOT_BLOCKED'
        });
      }
      
      // Remove block record
      await redisClient.del(blockKey);
      
      // Remove from block list
      const blockListKey = `blocklist:${blockerAddr}`;
      await redisClient.sRem(blockListKey, targetAddr);
      
      console.log('User unblocked:', {
        blocker: blockerAddr,
        target: targetAddr,
        timestamp: new Date().toISOString()
      });
      
      res.json({
        message: 'User unblocked successfully',
        targetAddr,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error unblocking user:', error);
      res.status(500).json({
        error: 'Failed to unblock user',
        code: 'UNBLOCK_USER_FAILED'
      });
    }
  }
);

// GET /blocks - Get user's block list
router.get('/',
  generalRateLimit,
  authenticateToken,
  async (req: AuthRequest, res: express.Response): Promise<any> => {
    try {
      const blockerAddr = req.user!.address.toLowerCase();
      const blockListKey = `blocklist:${blockerAddr}`;
      
      // Get all blocked addresses
      const blockedAddresses = await redisClient.sMembers(blockListKey);
      
      // Get detailed block information
      const blockDetails = await Promise.all(
        blockedAddresses.map(async (targetAddr) => {
          const blockKey = `block:${blockerAddr}:${targetAddr}`;
          const blockData = await redisClient.get(blockKey);
          
          if (blockData) {
            const parsed = JSON.parse(blockData);
            return {
              address: targetAddr,
              reason: parsed.reason,
              blockedAt: parsed.timestamp
            };
          }
          
          return {
            address: targetAddr,
            reason: 'Unknown',
            blockedAt: new Date().toISOString()
          };
        })
      );
      
      res.json({
        blocklist: blockDetails,
        total: blockDetails.length
      });
    } catch (error) {
      console.error('Error fetching block list:', error);
      res.status(500).json({
        error: 'Failed to fetch block list',
        code: 'FETCH_BLOCKLIST_FAILED'
      });
    }
  }
);

// GET /blocks/check/:address - Check if a specific user is blocked
router.get('/check/:address',
  generalRateLimit,
  authenticateToken,
  async (req: AuthRequest, res: express.Response): Promise<any> => {
    try {
      const targetAddr = req.params.address.toLowerCase();
      const blockerAddr = req.user!.address.toLowerCase();
      
      const blockKey = `block:${blockerAddr}:${targetAddr}`;
      const blockData = await redisClient.get(blockKey);
      
      if (blockData) {
        const parsed = JSON.parse(blockData);
        res.json({
          isBlocked: true,
          reason: parsed.reason,
          blockedAt: parsed.timestamp
        });
      } else {
        res.json({
          isBlocked: false
        });
      }
    } catch (error) {
      console.error('Error checking block status:', error);
      res.status(500).json({
        error: 'Failed to check block status',
        code: 'CHECK_BLOCK_FAILED'
      });
    }
  }
);

export default router;
