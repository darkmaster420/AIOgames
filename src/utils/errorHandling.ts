import { NextResponse } from 'next/server';
import logger from './logger';

/**
 * Standard error messages for better UX
 */
export const ERROR_MESSAGES = {
  // Authentication errors
  UNAUTHORIZED: "Please sign in to access this feature",
  FORBIDDEN: "You don't have permission to access this resource",
  SESSION_EXPIRED: "Your session has expired. Please sign in again",

  // Game-related errors
  GAME_NOT_FOUND: "We couldn't find that game. Try different keywords or check the spelling",
  GAME_ALREADY_TRACKED: "This game is already in your tracking list",
  INVALID_GAME_NAME: "Game name contains invalid characters. Please use only letters, numbers, and basic punctuation",
  
  // Update-related errors
  UPDATE_CHECK_FAILED: "Update check failed. Please try again in a few moments",
  NO_UPDATES_AVAILABLE: "No updates available for your tracked games",
  UPDATE_ALREADY_APPLIED: "This update has already been applied to your game",
  
  // Network errors
  NETWORK_ERROR: "Connection issue. Please check your internet and try again",
  API_UNAVAILABLE: "Game database temporarily unavailable. Please try again later",
  TIMEOUT_ERROR: "Request timed out. The server might be busy, please try again",
  
  // Validation errors
  INVALID_INPUT: "Please check your input and try again",
  MISSING_REQUIRED_FIELDS: "Please fill in all required fields",
  INPUT_TOO_LONG: "Input is too long. Please shorten your text",
  
  // Rate limiting
  RATE_LIMITED: "Too many requests. Please wait a moment before trying again",
  QUOTA_EXCEEDED: "Daily quota exceeded. Please try again tomorrow",
  
  // System errors
  DATABASE_ERROR: "Database temporarily unavailable. Please try again later",
  INTERNAL_ERROR: "Something went wrong on our end. We're working to fix it",
  MAINTENANCE_MODE: "System is under maintenance. Please check back shortly",
  
  // User errors
  INVALID_USER_DATA: "Invalid user information provided",
  ACCOUNT_DISABLED: "Your account has been disabled. Please contact support",
  
  // Notification errors
  NOTIFICATION_FAILED: "Failed to send notification. Your game is still tracked",
  INVALID_NOTIFICATION_SETTINGS: "Invalid notification preferences. Please check your settings"
};

/**
 * Error types for better error categorization
 */
export enum ErrorType {
  VALIDATION = 'VALIDATION_ERROR',
  AUTHENTICATION = 'AUTH_ERROR', 
  AUTHORIZATION = 'AUTHZ_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMIT = 'RATE_LIMIT',
  NETWORK = 'NETWORK_ERROR',
  DATABASE = 'DATABASE_ERROR',
  INTERNAL = 'INTERNAL_ERROR'
}

/**
 * Custom error class for API errors
 */
export class APIError extends Error {
  public readonly type: ErrorType;
  public readonly statusCode: number;
  public readonly userMessage: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    type: ErrorType,
    statusCode: number,
    userMessage: string,
    details?: Record<string, unknown>,
    internalMessage?: string
  ) {
    super(internalMessage || userMessage);
    this.type = type;
    this.statusCode = statusCode;
    this.userMessage = userMessage;
    this.details = details;
    this.name = 'APIError';
  }
}

/**
 * Create standardized error responses
 */
export function createErrorResponse(
  error: APIError | Error | unknown,
  fallbackMessage = ERROR_MESSAGES.INTERNAL_ERROR
): NextResponse {
  if (error instanceof APIError) {
    logger.warn(`API Error [${error.type}]:`, error.userMessage, error.details);
    
    return NextResponse.json(
      {
        error: error.userMessage,
        type: error.type,
        ...(error.details && { details: error.details })
      },
      { status: error.statusCode }
    );
  }

  if (error instanceof Error) {
    // Log internal errors but don't expose details to user
    logger.error('Unexpected error:', error.message, error.stack);
    
    return NextResponse.json(
      { 
        error: fallbackMessage,
        type: ErrorType.INTERNAL 
      },
      { status: 500 }
    );
  }

  // Unknown error type
  logger.error('Unknown error type:', error);
  
  return NextResponse.json(
    { 
      error: fallbackMessage,
      type: ErrorType.INTERNAL 
    },
    { status: 500 }
  );
}

/**
 * Predefined error creators for common scenarios
 */
export const errors = {
  unauthorized: () => new APIError(
    ErrorType.AUTHENTICATION,
    401,
    ERROR_MESSAGES.UNAUTHORIZED
  ),

  forbidden: () => new APIError(
    ErrorType.AUTHORIZATION,
    403,
    ERROR_MESSAGES.FORBIDDEN
  ),

  notFound: (resource = 'resource') => new APIError(
    ErrorType.NOT_FOUND,
    404,
    resource === 'game' ? ERROR_MESSAGES.GAME_NOT_FOUND : `${resource} not found`
  ),

  invalidInput: (details?: Record<string, unknown>) => new APIError(
    ErrorType.VALIDATION,
    400,
    ERROR_MESSAGES.INVALID_INPUT,
    details
  ),

  rateLimited: (retryAfter?: number) => new APIError(
    ErrorType.RATE_LIMIT,
    429,
    ERROR_MESSAGES.RATE_LIMITED,
    retryAfter ? { retryAfter } : undefined
  ),

  gameAlreadyTracked: () => new APIError(
    ErrorType.CONFLICT,
    409,
    ERROR_MESSAGES.GAME_ALREADY_TRACKED
  ),

  networkError: () => new APIError(
    ErrorType.NETWORK,
    502,
    ERROR_MESSAGES.NETWORK_ERROR
  ),

  databaseError: () => new APIError(
    ErrorType.DATABASE,
    503,
    ERROR_MESSAGES.DATABASE_ERROR
  ),

  updateCheckFailed: () => new APIError(
    ErrorType.INTERNAL,
    500,
    ERROR_MESSAGES.UPDATE_CHECK_FAILED
  )
};

/**
 * Async error handler wrapper for API routes
 */
export function withErrorHandling<T extends unknown[], R>(
  handler: (...args: T) => Promise<R>,
  fallbackMessage?: string
) {
  return async (...args: T): Promise<R | NextResponse> => {
    try {
      return await handler(...args);
    } catch (error) {
      return createErrorResponse(error, fallbackMessage);
    }
  };
}

/**
 * Parse and categorize common error types
 */
export function parseError(error: unknown): APIError {
  // MongoDB errors
  if (error && typeof error === 'object' && 'name' in error) {
    const err = error as { name: string; message?: string };
    
    if (err.name === 'MongoError' || err.name === 'MongooseError') {
      return errors.databaseError();
    }

    // Network/fetch errors
    if (err.name === 'TypeError' && err.message?.includes('fetch')) {
      return errors.networkError();
    }

    // Validation errors
    if (err.name === 'ValidationError') {
      return errors.invalidInput(err.message ? { message: err.message } : undefined);
    }

    // Timeout errors
    if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
      return new APIError(
        ErrorType.NETWORK,
        408,
        ERROR_MESSAGES.TIMEOUT_ERROR
      );
    }
  }

  // Default to internal error
  const message = error instanceof Error ? error.message : 'Unknown error';
  return new APIError(
    ErrorType.INTERNAL,
    500,
    ERROR_MESSAGES.INTERNAL_ERROR,
    undefined,
    message
  );
}