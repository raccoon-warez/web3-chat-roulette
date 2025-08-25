import express from 'express';
import authenticateToken, { AuthRequest } from '../middleware/auth';
import { reportRateLimit, createWalletRateLimit } from '../middleware/rateLimiter';
import { 
  validateReportSubmission,
  sanitizeAndValidateInput,
  handleValidationErrors
} from '../middleware/validation';
import { redisClient } from '../utils/redis';

const router = express.Router();

// POST /reports - Create a new report
router.post('/',
  reportRateLimit,
  createWalletRateLimit(5, 60), // Max 5 reports per hour per wallet
  authenticateToken,
  validateReportSubmission,
  sanitizeAndValidateInput,
  handleValidationErrors,
  async (req: AuthRequest, res: express.Response): Promise<any> => {
    try {
      const { targetAddr, sessionId, reason, notes } = req.body;
      const reporterAddr = req.user!.address;
      
      // Prevent self-reporting
      if (targetAddr.toLowerCase() === reporterAddr.toLowerCase()) {
        return res.status(400).json({
          error: 'Cannot report yourself',
          code: 'SELF_REPORT_NOT_ALLOWED'
        });
      }
      
      // Check for duplicate reports within a time window
      const duplicateKey = `report_duplicate:${reporterAddr}:${targetAddr}`;
      const existingReport = await redisClient.get(duplicateKey);
      
      if (existingReport) {
        return res.status(429).json({
          error: 'You have already reported this user recently',
          code: 'DUPLICATE_REPORT',
          retryAfter: 3600 // 1 hour
        });
      }
      
      // Create report record
      const reportId = `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const report = {
        id: reportId,
        reporterAddr,
        targetAddr: targetAddr.toLowerCase(),
        sessionId,
        reason,
        notes: notes || '',
        timestamp: new Date().toISOString(),
        status: 'pending',
        ip: req.ip || req.socket.remoteAddress
      };
      
      // Store report in Redis (in production, this would go to a database)
      await redisClient.setEx(`report:${reportId}`, 24 * 60 * 60, JSON.stringify(report));
      
      // Set duplicate prevention
      await redisClient.setEx(duplicateKey, 3600, 'true'); // 1 hour
      
      // Increment report count for target address
      const reportCountKey = `report_count:${targetAddr.toLowerCase()}`;
      const reportCount = await redisClient.incr(reportCountKey);
      
      // Set expiry for report count if it's the first report
      if (reportCount === 1) {
        await redisClient.expire(reportCountKey, 24 * 60 * 60); // 24 hours
      }
      
      // Log the report for monitoring
      console.log('New report submitted:', {
        reportId,
        reporterAddr,
        targetAddr,
        reason,
        timestamp: report.timestamp,
        totalReportsForTarget: reportCount
      });
      
      // Check if target user should be flagged for review (e.g., 3+ reports in 24h)
      if (reportCount >= 3) {
        console.warn(`User ${targetAddr} flagged for review: ${reportCount} reports in 24h`);
        
        // Store flag for moderation review
        await redisClient.setEx(
          `moderation_flag:${targetAddr.toLowerCase()}`, 
          24 * 60 * 60, 
          JSON.stringify({
            flaggedAt: new Date().toISOString(),
            reportCount,
            reason: 'Multiple reports received'
          })
        );
      }
      
      res.status(201).json({
        id: reportId,
        message: 'Report submitted successfully',
        timestamp: report.timestamp
      });
    } catch (error) {
      console.error('Error creating report:', error);
      res.status(500).json({
        error: 'Failed to submit report',
        code: 'REPORT_SUBMISSION_FAILED'
      });
    }
  }
);

// GET /reports/my - Get reports submitted by the authenticated user
router.get('/my',
  authenticateToken,
  async (req: AuthRequest, res: express.Response): Promise<any> => {
    try {
      const reporterAddr = req.user!.address;
      
      // In production, this would query a database
      // For now, we'll return a placeholder response
      res.json({
        reports: [],
        message: 'Feature coming soon - report history'
      });
    } catch (error) {
      console.error('Error fetching user reports:', error);
      res.status(500).json({
        error: 'Failed to fetch reports',
        code: 'FETCH_REPORTS_FAILED'
      });
    }
  }
);

// GET /reports/stats - Get reporting statistics (for moderation purposes)
router.get('/stats',
  authenticateToken,
  async (req: AuthRequest, res: express.Response): Promise<any> => {
    try {
      // Basic stats - in production this would be more comprehensive
      const stats = {
        totalReports: 0,
        pendingReports: 0,
        resolvedReports: 0,
        flaggedUsers: 0
      };
      
      // Get count of flagged users
      const flaggedUserKeys = await redisClient.keys('moderation_flag:*');
      stats.flaggedUsers = flaggedUserKeys.length;
      
      res.json(stats);
    } catch (error) {
      console.error('Error fetching report stats:', error);
      res.status(500).json({
        error: 'Failed to fetch report statistics',
        code: 'FETCH_STATS_FAILED'
      });
    }
  }
);

export default router;
