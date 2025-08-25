import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';

// Ethereum address validation schema
const ethereumAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

// Chain ID validation schema  
const chainIdSchema = z.number().int().positive();

// UUID validation schema
const uuidSchema = z.string().uuid('Invalid UUID format');

// Generic validation middleware factory
export const validateSchema = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): any => {
    try {
      // Validate request body, params, and query
      const data = {
        body: req.body,
        params: req.params,
        query: req.query
      };
      
      schema.parse(data);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
            code: err.code
          }))
        });
      }
      
      return res.status(400).json({
        error: 'Invalid request data'
      });
    }
  };
};

// SIWE nonce request validation
export const validateSiweNonceRequest = validateSchema(
  z.object({
    query: z.object({}).optional(),
    params: z.object({}).optional(),
    body: z.object({}).optional()
  })
);

// SIWE verification validation
export const validateSiweVerification = validateSchema(
  z.object({
    body: z.object({
      message: z.string()
        .min(1, 'Message is required')
        .max(5000, 'Message too long'),
      signature: z.string()
        .min(1, 'Signature is required')
        .regex(/^0x[a-fA-F0-9]+$/, 'Invalid signature format')
    }),
    params: z.object({}).optional(),
    query: z.object({}).optional()
  })
);

// Report submission validation
export const validateReportSubmission = validateSchema(
  z.object({
    body: z.object({
      targetAddr: ethereumAddressSchema,
      sessionId: uuidSchema.optional(),
      reason: z.enum(['inappropriate_content', 'harassment', 'spam', 'other'])
        .or(z.string().min(1).max(50)), // Allow custom reasons with length limit
      notes: z.string()
        .max(1000, 'Notes too long')
        .optional(),
      timestamp: z.number()
        .int()
        .positive()
        .optional()
        .default(() => Date.now())
    }),
    params: z.object({}).optional(),
    query: z.object({}).optional()
  })
);

// Block user validation
export const validateBlockUser = validateSchema(
  z.object({
    body: z.object({
      targetAddr: ethereumAddressSchema,
      reason: z.string()
        .min(1, 'Reason is required')
        .max(200, 'Reason too long')
        .optional()
    }),
    params: z.object({}).optional(),
    query: z.object({}).optional()
  })
);

// Unblock user validation
export const validateUnblockUser = validateSchema(
  z.object({
    params: z.object({
      address: ethereumAddressSchema
    }),
    body: z.object({}).optional(),
    query: z.object({}).optional()
  })
);

// Balance query validation
export const validateBalanceQuery = validateSchema(
  z.object({
    params: z.object({
      address: ethereumAddressSchema
    }),
    query: z.object({
      chainId: z.string()
        .regex(/^\d+$/, 'Chain ID must be numeric')
        .transform(val => parseInt(val, 10))
        .pipe(chainIdSchema)
        .optional()
    }),
    body: z.object({}).optional()
  })
);

// WebSocket connection validation
export const validateWebSocketConnection = (url: string, headers: Record<string, string>): { valid: boolean; error?: string } => {
  try {
    const parsedUrl = new URL(url, 'ws://localhost');
    const userId = parsedUrl.searchParams.get('userId');
    const token = parsedUrl.searchParams.get('token') || headers.authorization?.replace('Bearer ', '');
    
    if (userId && !uuidSchema.safeParse(userId).success) {
      return { valid: false, error: 'Invalid user ID format' };
    }
    
    if (token && !z.string().min(1).safeParse(token).success) {
      return { valid: false, error: 'Invalid token format' };
    }
    
    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Invalid WebSocket URL format' };
  }
};

// Express-validator based validations for additional security
export const sanitizeAndValidateInput = [
  // Sanitize inputs
  body('*').trim().escape(),
  
  // Custom validation for common injection patterns
  body('*').custom((value, { path }) => {
    if (typeof value === 'string') {
      // Check for potential script injection
      if (/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(value)) {
        throw new Error(`Script injection detected in ${path}`);
      }
      
      // Check for SQL injection patterns (basic)
      const sqlPatterns = [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
        /(UNION|OR|AND)\s+\d+\s*=\s*\d+/gi,
        /['"];?\s*(DROP|DELETE|INSERT|UPDATE)/gi
      ];
      
      for (const pattern of sqlPatterns) {
        if (pattern.test(value)) {
          throw new Error(`Potential SQL injection detected in ${path}`);
        }
      }
    }
    
    return true;
  })
];

// Validation result handler
export const handleValidationErrors = (req: Request, res: Response, next: NextFunction): any => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(err => ({
        field: err.type === 'field' ? err.path : 'unknown',
        message: err.msg,
        value: err.type === 'field' ? err.value : undefined
      }))
    });
  }
  
  return next();
};

// File upload validation (if needed for future features)
export const validateFileUpload = (maxSize: number = 5 * 1024 * 1024) => { // 5MB default
  return (req: Request, res: Response, next: NextFunction): any => {
    if (req.headers['content-length']) {
      const contentLength = parseInt(req.headers['content-length'], 10);
      if (contentLength > maxSize) {
        return res.status(413).json({
          error: 'File too large',
          maxSize: maxSize,
          receivedSize: contentLength
        });
      }
    }
    
    return next();
  };
};

// Generic sanitization middleware
export const sanitizeRequest = (req: Request, res: Response, next: NextFunction): any => {
  // Remove any null bytes
  const sanitizeValue = (obj: any): any => {
    if (typeof obj === 'string') {
      return obj.replace(/\0/g, '');
    } else if (Array.isArray(obj)) {
      return obj.map(sanitizeValue);
    } else if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitizeValue(value);
      }
      return sanitized;
    }
    return obj;
  };
  
  req.body = sanitizeValue(req.body);
  req.params = sanitizeValue(req.params);
  req.query = sanitizeValue(req.query);
  
  next();
};