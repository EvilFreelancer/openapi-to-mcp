import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadInstructions, InstructionsMode, combineInstructions } from '../src/instructions-loader';
import { htmlToMarkdown, containsHtml } from '../src/openapi-to-tools';

describe('instructions-loader', () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instructions-test-'));
    testFile = path.join(tempDir, 'instructions.txt');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('loadInstructions', () => {
    it('loads instructions from file successfully', async () => {
      const content = 'Custom instructions from file';
      fs.writeFileSync(testFile, content, 'utf-8');

      const result = await loadInstructions(testFile);
      expect(result).toBe(content);
    });

    it('returns null when file path is null', async () => {
      const result = await loadInstructions(null);
      expect(result).toBeNull();
    });

    it('returns null when file path is empty string', async () => {
      const result = await loadInstructions('');
      expect(result).toBeNull();
    });

    it('throws error when file does not exist', async () => {
      const nonExistentFile = path.join(tempDir, 'nonexistent.txt');
      await expect(loadInstructions(nonExistentFile)).rejects.toThrow();
    });

    it('loads file with UTF-8 encoding', async () => {
      const content = 'Инструкции на русском языке\nInstructions in English';
      fs.writeFileSync(testFile, content, 'utf-8');

      const result = await loadInstructions(testFile);
      expect(result).toBe(content);
    });

    it('preserves newlines and formatting', async () => {
      const content = 'Line 1\nLine 2\n\nLine 3';
      fs.writeFileSync(testFile, content, 'utf-8');

      const result = await loadInstructions(testFile);
      expect(result).toBe(content);
    });
  });

  describe('combineInstructions', () => {
    const openApiInstructions = 'OpenAPI description';

    it('returns OpenAPI instructions when mode is default', () => {
      const result = combineInstructions(openApiInstructions, null, InstructionsMode.DEFAULT);
      expect(result).toBe(openApiInstructions);
    });

    it('returns OpenAPI instructions when mode is default even if file instructions exist', () => {
      const fileInstructions = 'File instructions';
      const result = combineInstructions(openApiInstructions, fileInstructions, InstructionsMode.DEFAULT);
      expect(result).toBe(openApiInstructions);
    });

    it('replaces with file instructions when mode is replace and file exists', () => {
      const fileInstructions = 'File instructions';
      const result = combineInstructions(openApiInstructions, fileInstructions, InstructionsMode.REPLACE);
      expect(result).toBe(fileInstructions);
    });

    it('returns null when mode is replace but file instructions is null', () => {
      const result = combineInstructions(openApiInstructions, null, InstructionsMode.REPLACE);
      expect(result).toBeNull();
    });

    it('appends file instructions when mode is append', () => {
      const fileInstructions = 'File instructions';
      const result = combineInstructions(openApiInstructions, fileInstructions, InstructionsMode.APPEND);
      expect(result).toBe('OpenAPI description\n\nFile instructions');
    });

    it('returns only OpenAPI instructions when mode is append but file is null', () => {
      const result = combineInstructions(openApiInstructions, null, InstructionsMode.APPEND);
      expect(result).toBe(openApiInstructions);
    });

    it('prepends file instructions when mode is prepend', () => {
      const fileInstructions = 'File instructions';
      const result = combineInstructions(openApiInstructions, fileInstructions, InstructionsMode.PREPEND);
      expect(result).toBe('File instructions\n\nOpenAPI description');
    });

    it('returns only OpenAPI instructions when mode is prepend but file is null', () => {
      const result = combineInstructions(openApiInstructions, null, InstructionsMode.PREPEND);
      expect(result).toBe(openApiInstructions);
    });

    it('handles empty OpenAPI instructions with append mode', () => {
      const fileInstructions = 'File instructions';
      const result = combineInstructions('', fileInstructions, InstructionsMode.APPEND);
      expect(result).toBe('File instructions');
    });

    it('handles empty OpenAPI instructions with prepend mode', () => {
      const fileInstructions = 'File instructions';
      const result = combineInstructions('', fileInstructions, InstructionsMode.PREPEND);
      expect(result).toBe('File instructions');
    });

    it('handles null OpenAPI instructions with append mode', () => {
      const fileInstructions = 'File instructions';
      const result = combineInstructions(null, fileInstructions, InstructionsMode.APPEND);
      expect(result).toBe('File instructions');
    });

    it('handles null OpenAPI instructions with prepend mode', () => {
      const fileInstructions = 'File instructions';
      const result = combineInstructions(null, fileInstructions, InstructionsMode.PREPEND);
      expect(result).toBe('File instructions');
    });

    it('returns null when both are null and mode is append', () => {
      const result = combineInstructions(null, null, InstructionsMode.APPEND);
      expect(result).toBeNull();
    });

    it('returns null when both are null and mode is prepend', () => {
      const result = combineInstructions(null, null, InstructionsMode.PREPEND);
      expect(result).toBeNull();
    });
  });

  describe('HTML to Markdown conversion for info.description', () => {
    it('converts HTML in info.description to Markdown', () => {
      const htmlDescription = 'API Server Description.<br/><br/>This server provides access to <b>RESTful</b> endpoints for managing resources.';
      const converted = htmlToMarkdown(htmlDescription);
      
      // HTML should be converted to Markdown
      expect(converted).not.toContain('<br/>');
      expect(converted).not.toContain('<b>');
      expect(converted).not.toContain('</b>');
      // Should contain markdown equivalents
      expect(converted).toContain('**RESTful**');
    });

    it('does not modify plain text descriptions without HTML', () => {
      const plainText = 'API Server Description. This server provides access to RESTful endpoints.';
      const converted = htmlToMarkdown(plainText);
      expect(converted).toBe(plainText);
    });

    it('detects HTML tags correctly', () => {
      expect(containsHtml('Text with <b>bold</b> tag')).toBe(true);
      expect(containsHtml('Text with <br/> tag')).toBe(true);
      expect(containsHtml('Plain text without tags')).toBe(false);
      expect(containsHtml('Text with < symbol but no tag')).toBe(false);
    });
  });
});
