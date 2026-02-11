import { Logger, LogLevel, getCorrelationId, generateCorrelationId } from '../src/logger';

describe('logger', () => {
  const originalEnv = process.env;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleDebug = console.debug;

  let logOutput: string[] = [];
  let errorOutput: string[] = [];
  let warnOutput: string[] = [];
  let debugOutput: string[] = [];

  beforeEach(() => {
    logOutput = [];
    errorOutput = [];
    warnOutput = [];
    debugOutput = [];
    process.env = { ...originalEnv };
    console.log = (...args: unknown[]) => {
      logOutput.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      errorOutput.push(args.map(String).join(' '));
    };
    console.warn = (...args: unknown[]) => {
      warnOutput.push(args.map(String).join(' '));
    };
    console.debug = (...args: unknown[]) => {
      debugOutput.push(args.map(String).join(' '));
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    console.debug = originalConsoleDebug;
  });

  describe('LogLevel', () => {
    it('has correct enum values', () => {
      expect(LogLevel.DEBUG).toBe('DEBUG');
      expect(LogLevel.INFO).toBe('INFO');
      expect(LogLevel.WARN).toBe('WARN');
      expect(LogLevel.ERROR).toBe('ERROR');
    });
  });

  describe('generateCorrelationId', () => {
    it('generates unique IDs', () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();
      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
      expect(id1.length).toBeGreaterThan(0);
    });

    it('generates IDs with expected format', () => {
      const id = generateCorrelationId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(10);
    });
  });

  describe('getCorrelationId', () => {
    it('extracts correlation ID from headers', () => {
      const req = {
        headers: {
          'x-correlation-id': 'test-correlation-123',
        },
      } as never;
      const id = getCorrelationId(req);
      expect(id).toBe('test-correlation-123');
    });

    it('extracts correlation ID from headers case-insensitive', () => {
      const req = {
        headers: {
          'X-Correlation-ID': 'test-correlation-456',
        },
      } as never;
      const id = getCorrelationId(req);
      expect(id).toBe('test-correlation-456');
    });

    it('generates new ID if not in headers', () => {
      const req = {
        headers: {},
      } as never;
      const id = getCorrelationId(req);
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('generates new ID if header is empty', () => {
      const req = {
        headers: {
          'x-correlation-id': '',
        },
      } as never;
      const id = getCorrelationId(req);
      expect(id).toBeTruthy();
      expect(id).not.toBe('');
    });
  });

  describe('Logger', () => {
    it('creates logger with default INFO level', () => {
      delete process.env.MCP_LOG_LEVEL;
      const logger = new Logger();
      expect(logger.getLevel()).toBe(LogLevel.INFO);
    });

    it('creates logger with level from env', () => {
      process.env.MCP_LOG_LEVEL = 'DEBUG';
      const logger = new Logger();
      expect(logger.getLevel()).toBe(LogLevel.DEBUG);
    });

    it('creates logger with level from env (case-insensitive)', () => {
      process.env.MCP_LOG_LEVEL = 'error';
      const logger = new Logger();
      expect(logger.getLevel()).toBe(LogLevel.ERROR);
    });

    it('defaults to INFO for invalid level', () => {
      process.env.MCP_LOG_LEVEL = 'INVALID';
      const logger = new Logger();
      expect(logger.getLevel()).toBe(LogLevel.INFO);
    });

    it('logs DEBUG messages when level is DEBUG', () => {
      process.env.MCP_LOG_LEVEL = 'DEBUG';
      const logger = new Logger();
      logger.debug('test-id', 'Debug message');
      expect(debugOutput.length).toBeGreaterThan(0);
      expect(debugOutput[0]).toContain('[test-id]');
      expect(debugOutput[0]).toContain('DEBUG');
      expect(debugOutput[0]).toContain('Debug message');
    });

    it('does not log DEBUG messages when level is INFO', () => {
      process.env.MCP_LOG_LEVEL = 'INFO';
      const logger = new Logger();
      logger.debug('test-id', 'Debug message');
      expect(debugOutput.length).toBe(0);
    });

    it('logs INFO messages when level is INFO', () => {
      process.env.MCP_LOG_LEVEL = 'INFO';
      const logger = new Logger();
      logger.info('test-id', 'Info message');
      expect(logOutput.length).toBeGreaterThan(0);
      expect(logOutput[0]).toContain('[test-id]');
      expect(logOutput[0]).toContain('INFO');
      expect(logOutput[0]).toContain('Info message');
    });

    it('logs INFO messages when level is DEBUG', () => {
      process.env.MCP_LOG_LEVEL = 'DEBUG';
      const logger = new Logger();
      logger.info('test-id', 'Info message');
      expect(logOutput.length).toBeGreaterThan(0);
    });

    it('does not log INFO messages when level is WARN', () => {
      process.env.MCP_LOG_LEVEL = 'WARN';
      const logger = new Logger();
      logger.info('test-id', 'Info message');
      expect(logOutput.length).toBe(0);
    });

    it('logs WARN messages when level is WARN', () => {
      process.env.MCP_LOG_LEVEL = 'WARN';
      const logger = new Logger();
      logger.warn('test-id', 'Warning message');
      expect(warnOutput.length).toBeGreaterThan(0);
      expect(warnOutput[0]).toContain('[test-id]');
      expect(warnOutput[0]).toContain('WARN');
      expect(warnOutput[0]).toContain('Warning message');
    });

    it('does not log WARN messages when level is ERROR', () => {
      process.env.MCP_LOG_LEVEL = 'ERROR';
      const logger = new Logger();
      logger.warn('test-id', 'Warning message');
      expect(warnOutput.length).toBe(0);
    });

    it('logs ERROR messages', () => {
      process.env.MCP_LOG_LEVEL = 'ERROR';
      const logger = new Logger();
      logger.error('test-id', 'Error message');
      expect(errorOutput.length).toBeGreaterThan(0);
      expect(errorOutput[0]).toContain('[test-id]');
      expect(errorOutput[0]).toContain('ERROR');
      expect(errorOutput[0]).toContain('Error message');
    });

    it('logs ERROR messages at any level', () => {
      process.env.MCP_LOG_LEVEL = 'DEBUG';
      const logger = new Logger();
      logger.error('test-id', 'Error message');
      expect(errorOutput.length).toBeGreaterThan(0);
    });

    it('includes error object in ERROR log', () => {
      process.env.MCP_LOG_LEVEL = 'ERROR';
      const logger = new Logger();
      const err = new Error('Test error');
      logger.error('test-id', 'Error occurred', err);
      expect(errorOutput.length).toBeGreaterThan(0);
      expect(errorOutput[0]).toContain('[test-id]');
      expect(errorOutput[0]).toContain('Error occurred');
    });

    it('formats log message correctly', () => {
      process.env.MCP_LOG_LEVEL = 'INFO';
      const logger = new Logger();
      logger.info('corr-123', 'Test message');
      expect(logOutput[0]).toMatch(/\[corr-123\]\s+INFO\s+Test message/);
    });
  });
});
