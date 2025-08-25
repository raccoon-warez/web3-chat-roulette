import express from 'express';
import authenticateToken, { AuthRequest, optionalAuth } from '../middleware/auth';
import { generalRateLimit, createWalletRateLimit } from '../middleware/rateLimiter';
import { 
  validateBalanceQuery,
  sanitizeRequest
} from '../middleware/validation';
import { redisClient } from '../utils/redis';

const router = express.Router();

// Cache balance data for a short period to reduce blockchain calls
const BALANCE_CACHE_TTL = 30; // 30 seconds

// GET /balances/:address - Get specific user's token balances (public endpoint)
router.get('/:address',
  generalRateLimit,
  createWalletRateLimit(60, 15), // Max 60 requests per 15 minutes per wallet
  optionalAuth, // Optional authentication
  validateBalanceQuery,
  sanitizeRequest,
  async (req: AuthRequest, res): Promise<any> => {
    try {
      const address = req.params.address.toLowerCase();
      const chainId = parseInt(req.query.chainId as string) || 1;
      
      // Validate Ethereum address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return res.status(400).json({
          error: 'Invalid Ethereum address format',
          code: 'INVALID_ADDRESS'
        });
      }
      
      // Check cache first
      const cacheKey = `balance:${address}:${chainId}`;
      const cachedBalance = await redisClient.get(cacheKey);
      
      if (cachedBalance) {
        const parsed = JSON.parse(cachedBalance);
        return res.json({
          ...parsed,
          cached: true,
          cacheAge: Date.now() - parsed.timestamp
        });
      }
      
      // In a real implementation, this would fetch from blockchain
      // For now, return mock data based on address characteristics
      const mockBalance = generateMockBalance(address, chainId);
      
      // Cache the result
      const balanceData = {
        ...mockBalance,
        timestamp: Date.now(),
        address,
        chainId
      };
      
      await redisClient.setEx(cacheKey, BALANCE_CACHE_TTL, JSON.stringify(balanceData));
      
      // Log balance request for monitoring
      console.log('Balance requested:', {
        address,
        chainId,
        requestedBy: req.user?.address || 'anonymous',
        ip: req.ip,
        timestamp: new Date().toISOString()
      });
      
      res.json({
        ...balanceData,
        cached: false
      });
    } catch (error) {
      console.error('Error fetching balances:', error);
      res.status(500).json({
        error: 'Failed to fetch balances',
        code: 'BALANCE_FETCH_FAILED'
      });
    }
  }
);

// GET /balances - Get authenticated user's token balances
router.get('/',
  generalRateLimit,
  authenticateToken,
  async (req: AuthRequest, res): Promise<any> => {
    try {
      const address = req.user!.address.toLowerCase();
      const chainId = parseInt(req.query.chainId as string) || req.user!.chainId || 1;
      
      // Check cache first
      const cacheKey = `balance:${address}:${chainId}`;
      const cachedBalance = await redisClient.get(cacheKey);
      
      if (cachedBalance) {
        const parsed = JSON.parse(cachedBalance);
        return res.json({
          ...parsed,
          cached: true,
          cacheAge: Date.now() - parsed.timestamp
        });
      }
      
      // Generate mock balance data
      const mockBalance = generateMockBalance(address, chainId);
      
      // Cache the result
      const balanceData = {
        ...mockBalance,
        timestamp: Date.now(),
        address,
        chainId
      };
      
      await redisClient.setEx(cacheKey, BALANCE_CACHE_TTL, JSON.stringify(balanceData));
      
      res.json({
        ...balanceData,
        cached: false
      });
    } catch (error) {
      console.error('Error fetching user balances:', error);
      res.status(500).json({
        error: 'Failed to fetch balances',
        code: 'BALANCE_FETCH_FAILED'
      });
    }
  }
);

// POST /balances/refresh - Force refresh balance cache
router.post('/refresh',
  generalRateLimit,
  authenticateToken,
  async (req: AuthRequest, res): Promise<any> => {
    try {
      const address = req.user!.address.toLowerCase();
      const chainId = parseInt(req.body.chainId) || req.user!.chainId || 1;
      
      // Clear cache
      const cacheKey = `balance:${address}:${chainId}`;
      await redisClient.del(cacheKey);
      
      // Generate fresh balance data
      const mockBalance = generateMockBalance(address, chainId);
      
      // Cache the fresh result
      const balanceData = {
        ...mockBalance,
        timestamp: Date.now(),
        address,
        chainId
      };
      
      await redisClient.setEx(cacheKey, BALANCE_CACHE_TTL, JSON.stringify(balanceData));
      
      console.log('Balance cache refreshed:', {
        address,
        chainId,
        timestamp: new Date().toISOString()
      });
      
      res.json({
        ...balanceData,
        cached: false,
        refreshed: true
      });
    } catch (error) {
      console.error('Error refreshing balances:', error);
      res.status(500).json({
        error: 'Failed to refresh balances',
        code: 'BALANCE_REFRESH_FAILED'
      });
    }
  }
);

// Generate mock balance data based on address
function generateMockBalance(address: string, chainId: number) {
  // Use address as seed for consistent mock data
  const seed = parseInt(address.slice(-8), 16);
  const random = (seed * 9301 + 49297) % 233280;
  
  const ethBalance = ((random % 10000) / 10000 * 5).toFixed(4);
  const ethPrice = 2000 + (random % 1000); // Mock ETH price
  
  const chains: Record<number, { name: string; symbol: string; explorer: string }> = {
    1: { name: 'Ethereum', symbol: 'ETH', explorer: 'etherscan.io' },
    137: { name: 'Polygon', symbol: 'MATIC', explorer: 'polygonscan.com' },
    56: { name: 'BSC', symbol: 'BNB', explorer: 'bscscan.com' },
    42161: { name: 'Arbitrum', symbol: 'ETH', explorer: 'arbiscan.io' }
  };
  
  const chain = chains[chainId] || chains[1];
  
  return {
    chain: {
      id: chainId,
      name: chain.name,
      symbol: chain.symbol,
      explorer: chain.explorer
    },
    native: {
      symbol: chain.symbol,
      balance: ethBalance,
      usdValue: parseFloat(ethBalance) * ethPrice,
      formatted: `${ethBalance} ${chain.symbol}`
    },
    erc20: [
      {
        address: '0xa0b86a33e6776e87c6ab17b0ce2f5f827c9e7f5f',
        symbol: 'USDC',
        name: 'USD Coin',
        balance: ((random % 1000) + 10).toString(),
        decimals: 6,
        usdValue: (random % 1000) + 10
      },
      {
        address: '0x6b175474e89094c44da98b954eedeac495271d0f',
        symbol: 'DAI',
        name: 'Dai Stablecoin',
        balance: ((random % 500) + 5).toString(),
        decimals: 18,
        usdValue: (random % 500) + 5
      }
    ],
    totalUsdValue: parseFloat(ethBalance) * ethPrice + (random % 1000) + 10 + (random % 500) + 5,
    lastUpdated: new Date().toISOString()
  };
}

export default router;
