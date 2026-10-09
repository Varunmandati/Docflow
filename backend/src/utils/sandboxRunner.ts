import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../config/logger.js';
import { env as appEnv } from '../config/env.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const execFileAsync = promisify(execFile);

export interface SandboxOptions {
    /** Maximum execution time in milliseconds (default: 60000 = 60s) */
    timeoutMs?: number;
    /** Maximum stdout/stderr buffer in bytes (default: 10MB) */
    maxBuffer?: number;
    /** Custom env vars. By default, it runs with minimal env. */
    env?: Record<string, string>;
    /** Whether to disable network (only applicable if using Docker backend) */
    disableNetwork?: boolean;
}

export class SandboxError extends Error {
    constructor(message: string, public readonly code: string, public readonly stderr?: string) {
        super(message);
        this.name = 'SandboxError';
    }
}

/**
 * Sandboxed Execution Wrapper.
 * Currently uses resource-limited Node subprocesses (timeout + maxBuffer).
 * Could be extended to wrap commands in `docker run` or `gVisor` for harder isolation.
 */
export class SandboxRunner {
    /**
     * Executes a CLI tool with strict resource limits.
     * @param command The binary to execute
     * @param args The arguments
     * @param options Sandbox limits
     * @returns The stdout of the command
     */
    static async execute(command: string, args: string[], options: SandboxOptions = {}): Promise<string> {
        const timeoutMs = options.timeoutMs || 60000;
        // Default to the same cap command.service.ts enforces, so a binary
        // invoked through either path has the same memory ceiling. A literal
        // 10MB here would silently disagree with COMMAND_MAX_OUTPUT_BYTES.
        const maxBuffer = options.maxBuffer || appEnv.COMMAND_MAX_OUTPUT_BYTES;
        const runId = crypto.randomBytes(4).toString('hex');
        
        // Use a restricted environment to avoid leaking host variables to child
        const env = options.env || {
            PATH: process.env.PATH, // Needed to resolve binaries
            HOME: process.env.HOME || '/tmp',
        };

        logger.info({ runId, command, args: args.join(' ') }, 'SandboxRunner starting execution');
        const startTime = Date.now();

        try {
            const { stdout, stderr } = await execFileAsync(command, args, {
                timeout: timeoutMs,
                maxBuffer,
                env,
                // Kill the entire process group if possible
                windowsHide: true,
            });

            const duration = Date.now() - startTime;
            logger.info({ runId, duration, stdoutLength: stdout.length }, 'SandboxRunner execution completed');
            
            return stdout;
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            if (error.killed && error.signal === 'SIGTERM') {
                logger.error({ runId, duration }, 'SandboxRunner execution timed out');
                throw new SandboxError(`Execution timed out after ${timeoutMs}ms`, 'TIMEOUT', error.stderr);
            }
            
            if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
                logger.error({ runId, duration }, 'SandboxRunner execution exceeded max buffer');
                throw new SandboxError(`Execution exceeded maximum output size of ${maxBuffer} bytes`, 'MAX_BUFFER', error.stderr);
            }

            logger.error({ runId, err: error, stderr: error.stderr }, 'SandboxRunner execution failed');
            throw new SandboxError(`Command failed: ${error.message}`, 'EXEC_FAILED', error.stderr);
        }
    }
}
