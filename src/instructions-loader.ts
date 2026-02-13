import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from './logger';

export enum InstructionsMode {
  DEFAULT = 'default',
  REPLACE = 'replace',
  APPEND = 'append',
  PREPEND = 'prepend',
}

/**
 * Loads instructions from a file.
 * @param filePath Path to the instructions file, or null/empty string to skip.
 * @returns File contents as string, or null if filePath is null/empty.
 * @throws Error if file does not exist or cannot be read.
 */
export async function loadInstructions(filePath: string | null): Promise<string | null> {
  if (!filePath || filePath.trim() === '') {
    return null;
  }

  const normalizedPath = path.resolve(filePath);
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`Instructions file not found: ${normalizedPath}`);
  }

  try {
    const content = fs.readFileSync(normalizedPath, 'utf-8');
    return content;
  } catch (error) {
    throw new Error(`Failed to read instructions file ${normalizedPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Combines OpenAPI instructions with file instructions according to the specified mode.
 * @param openApiInstructions Instructions from OpenAPI spec info.description (can be null or empty).
 * @param fileInstructions Instructions loaded from file (can be null).
 * @param mode Combination mode: default, replace, append, prepend.
 * @returns Combined instructions string, or null if no instructions available.
 */
export function combineInstructions(
  openApiInstructions: string | null | undefined,
  fileInstructions: string | null,
  mode: InstructionsMode,
): string | null {
  if (mode === InstructionsMode.DEFAULT) {
    return openApiInstructions || null;
  }

  if (mode === InstructionsMode.REPLACE) {
    if (!fileInstructions) {
      return null;
    }
    return fileInstructions;
  }

  if (mode === InstructionsMode.APPEND) {
    if (!fileInstructions) {
      return openApiInstructions || null;
    }
    if (!openApiInstructions) {
      return fileInstructions;
    }
    return `${openApiInstructions}\n\n${fileInstructions}`;
  }

  if (mode === InstructionsMode.PREPEND) {
    if (!fileInstructions) {
      return openApiInstructions || null;
    }
    if (!openApiInstructions) {
      return fileInstructions;
    }
    return `${fileInstructions}\n\n${openApiInstructions}`;
  }

  return null;
}

/**
 * Parses instructions mode from environment variable.
 * @param value Environment variable value (case-insensitive).
 * @returns InstructionsMode enum value, defaults to DEFAULT if invalid or not set.
 */
export function parseInstructionsMode(value: string | undefined): InstructionsMode {
  if (!value || value.trim() === '') {
    return InstructionsMode.DEFAULT;
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'replace':
      return InstructionsMode.REPLACE;
    case 'append':
      return InstructionsMode.APPEND;
    case 'prepend':
      return InstructionsMode.PREPEND;
    case 'default':
      return InstructionsMode.DEFAULT;
    case 'none':
      // Backward compatibility: 'none' is treated as 'default'
      return InstructionsMode.DEFAULT;
    default:
      logger.warn('startup', `Invalid MCP_INSTRUCTIONS_MODE value: ${value}. Using 'default'`, { value });
      return InstructionsMode.DEFAULT;
  }
}
