/**
 * Enhanced error handling utilities
 */

export interface RetryOptions {
  maxRetries?: number;
  retryDelay?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly filePath?: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxRetries = 3, retryDelay = 1000, onRetry } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt);
        if (onRetry) {
          onRetry(attempt + 1, lastError);
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw lastError;
    }
  }

  throw lastError!;
}

/**
 * Validate file path
 */
export function validateFilePath(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  // Check for dangerous paths
  if (filePath.includes('..')) {
    return false;
  }

  // Check for null bytes
  if (filePath.includes('\0')) {
    return false;
  }

  return true;
}

/**
 * Validate project path
 */
export function validateProjectPath(projectPath: string): void {
  if (!projectPath || typeof projectPath !== 'string') {
    throw new MigrationError('Project path is required', 'INVALID_PROJECT_PATH');
  }

  if (!validateFilePath(projectPath)) {
    throw new MigrationError('Invalid project path', 'INVALID_PROJECT_PATH', projectPath);
  }
}

/**
 * Safe file read with error handling
 */
export async function safeReadFile(
  filePath: string,
  encoding: BufferEncoding = 'utf-8'
): Promise<string> {
  if (!validateFilePath(filePath)) {
    throw new MigrationError('Invalid file path', 'INVALID_FILE_PATH', filePath);
  }

  try {
    const fs = await import('fs/promises');
    return await fs.readFile(filePath, encoding);
  } catch (error) {
    throw new MigrationError(
      `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      'FILE_READ_ERROR',
      filePath,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Safe file write with error handling
 */
export async function safeWriteFile(
  filePath: string,
  content: string,
  encoding: BufferEncoding = 'utf-8'
): Promise<void> {
  if (!validateFilePath(filePath)) {
    throw new MigrationError('Invalid file path', 'INVALID_FILE_PATH', filePath);
  }

  try {
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, content, encoding);
  } catch (error) {
    throw new MigrationError(
      `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
      'FILE_WRITE_ERROR',
      filePath,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Validate API key format based on provider
 */
export function validateApiKey(
  apiKey?: string,
  provider: 'openai' | 'mistral' | 'claude' | 'anthropic' = 'openai'
): boolean {
  if (!apiKey) {
    return false;
  }

  switch (provider) {
    case 'openai':
      // OpenAI keys start with sk- and are typically 51+ characters
      return apiKey.startsWith('sk-') && apiKey.length >= 20;
    case 'mistral':
      // Mistral keys format (to be implemented)
      return apiKey.length >= 20;
    case 'claude':
    case 'anthropic':
      // Anthropic keys start with sk-ant-
      return apiKey.startsWith('sk-ant-') && apiKey.length >= 20;
    default:
      return apiKey.length >= 20;
  }
}

/**
 * Detect API key provider from key format
 */
export function detectProviderFromKey(
  apiKey: string
): 'openai' | 'mistral' | 'claude' | 'anthropic' | null {
  if (apiKey.startsWith('sk-') && !apiKey.startsWith('sk-ant-')) {
    return 'openai';
  }
  if (apiKey.startsWith('sk-ant-')) {
    return 'anthropic';
  }
  // Mistral detection (to be implemented when format is known)
  return null;
}
