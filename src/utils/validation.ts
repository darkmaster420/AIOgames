import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Rate limiting map
const rateLimitMap = new Map<string, number[]>();

// Common validation schemas
export const schemas = {
  gameSearch: z.object({
    query: z.string().min(1).max(100).regex(/^[a-zA-Z0-9\s\-_.:()[\]&+]+$/, 'Invalid characters in search query'),
    site: z.string().optional(),
    limit: z.number().min(1).max(50).optional()
  }),
  
  gameAdd: z.object({
    gameName: z.string().min(1).max(100).regex(/^[a-zA-Z0-9\s\-_.:()[\]&+]+$/, 'Invalid characters in game name'),
    forceAdd: z.boolean().optional()
  }),
  
  updateFrequency: z.object({
    frequency: z.enum(['hourly', 'daily', 'weekly', 'manual']),
    gameId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid game ID format')
  }),
  
  userProfile: z.object({
    username: z.string().min(3).max(24).regex(/^[a-z0-9_]+$/, 'Username can only contain lowercase letters, numbers, and underscores').optional(),
    email: z.string().email().optional(),
    newPassword: z.string().min(6).max(128).optional(),
    currentPassword: z.string().optional()
  })
};

/**
 * Rate limiting middleware
 */
export function rateLimit(options: { 
  maxRequests: number; 
  windowMs: number; 
  message?: string;
}) {
  return (req: NextRequest): { allowed: boolean; response?: NextResponse } => {
    const ip = req.headers.get('x-forwarded-for') || 
              req.headers.get('x-real-ip') || 
              'unknown';
    
    const now = Date.now();
    const windowStart = now - options.windowMs;
    
    // Get or create request history for this IP
    const requests = rateLimitMap.get(ip) || [];
    
    // Filter out old requests
    const recentRequests = requests.filter(time => time > windowStart);
    
    // Check if limit exceeded
    if (recentRequests.length >= options.maxRequests) {
      return {
        allowed: false,
        response: NextResponse.json(
          { 
            error: options.message || 'Too many requests. Please try again later.',
            retryAfter: Math.ceil(options.windowMs / 1000)
          },
          { status: 429 }
        )
      };
    }
    
    // Add current request
    recentRequests.push(now);
    rateLimitMap.set(ip, recentRequests);
    
    return { allowed: true };
  };
}

/**
 * Input validation middleware
 */
export function validateInput<T>(schema: z.ZodSchema<T>) {
  return async (req: NextRequest): Promise<{ 
    valid: boolean; 
    data?: T; 
    response?: NextResponse 
  }> => {
    try {
      let inputData: Record<string, unknown>;
      
      if (req.method === 'GET') {
        // Extract from URL search params
        const url = new URL(req.url);
        inputData = Object.fromEntries(url.searchParams);
        
        // Convert numeric strings to numbers
        Object.keys(inputData).forEach(key => {
          const value = inputData[key];
          if (typeof value === 'string' && /^\d+$/.test(value)) {
            inputData[key] = parseInt(value, 10);
          }
        });
      } else {
        // Extract from request body
        const body = await req.text();
        if (!body) {
          return {
            valid: false,
            response: NextResponse.json(
              { error: 'Request body is required' },
              { status: 400 }
            )
          };
        }
        
        inputData = JSON.parse(body);
      }
      
      const validatedData = schema.parse(inputData);
      
      return {
        valid: true,
        data: validatedData
      };
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          valid: false,
          response: NextResponse.json(
            { 
              error: 'Invalid input',
              details: error.issues.map((err: z.ZodIssue) => ({
                field: err.path.join('.'),
                message: err.message
              }))
            },
            { status: 400 }
          )
        };
      }
      
      if (error instanceof SyntaxError) {
        return {
          valid: false,
          response: NextResponse.json(
            { error: 'Invalid JSON format' },
            { status: 400 }
          )
        };
      }
      
      return {
        valid: false,
        response: NextResponse.json(
          { error: 'Invalid request format' },
          { status: 400 }
        )
      };
    }
  };
}

/**
 * Sanitize string input to prevent XSS
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/[<>\"']/g, '') // Remove potentially dangerous characters
    .trim()
    .substring(0, 1000); // Limit length
}

/**
 * Helper to combine rate limiting and validation
 */
export function createSecureEndpoint<T>(options: {
  rateLimit: { maxRequests: number; windowMs: number; message?: string };
  schema: z.ZodSchema<T>;
}) {
  const rateLimiter = rateLimit(options.rateLimit);
  const validator = validateInput(options.schema);
  
  return {
    rateLimiter,
    validator
  };
}