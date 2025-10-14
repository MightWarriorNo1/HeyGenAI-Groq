// API helper utilities for better error handling and timeout management

export interface ApiCallOptions {
  timeout?: number;
  retries?: number;
  fallbackMessage?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const createApiCall = async <T>(
  apiCall: () => Promise<T>,
  options: ApiCallOptions = {}
): Promise<T> => {
  const {
    timeout = 30000,
    retries = 3,
    fallbackMessage = 'Request failed. Please try again.'
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new ApiError(`Request timed out after ${timeout}ms`, 408, 'TIMEOUT', true));
        }, timeout);
      });

      // Race between the API call and timeout
      const result = await Promise.race([apiCall(), timeoutPromise]);
      return result;
    } catch (error: any) {
      lastError = error;
      
      // Check if error is retryable
      const isRetryable = error instanceof ApiError ? error.retryable : 
        error.code === 'TIMEOUT' || 
        error.status >= 500 || 
        error.status === 429;

      if (attempt === retries || !isRetryable) {
        break;
      }

      // Exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // If we get here, all retries failed
  throw new ApiError(
    lastError?.message || fallbackMessage,
    lastError instanceof ApiError ? lastError.status : 500,
    lastError instanceof ApiError ? lastError.code : 'UNKNOWN',
    false
  );
};

export const handleApiError = (error: any): { title: string; description: string } => {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'TIMEOUT':
        return {
          title: 'Request timed out',
          description: 'The request took too long to complete. Please try again with a smaller file or simpler request.'
        };
      case 'RATE_LIMIT':
        return {
          title: 'Rate limit exceeded',
          description: 'Too many requests. Please wait a moment before trying again.'
        };
      default:
        return {
          title: 'API Error',
          description: error.message || 'An unexpected error occurred.'
        };
    }
  }

  if (error.status === 401) {
    return {
      title: 'Authentication Error',
      description: 'Invalid API key. Please check your configuration.'
    };
  }

  if (error.status === 429) {
    return {
      title: 'Rate Limit Exceeded',
      description: 'Too many requests. Please wait before trying again.'
    };
  }

  if (error.status >= 500) {
    return {
      title: 'Server Error',
      description: 'The API server is experiencing issues. Please try again later.'
    };
  }

  return {
    title: 'Unexpected Error',
    description: error.message || 'Something went wrong. Please try again.'
  };
};
