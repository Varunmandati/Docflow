import { spawn } from 'child_process';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
    /** True when a stream was truncated at COMMAND_MAX_OUTPUT_BYTES. */
    truncated?: boolean;
}

/**
 * Append a chunk to a bounded string buffer.
 *
 * An unbounded `stdout += chunk` is a memory-exhaustion vector: every one of
 * these binaries is invoked on user-supplied documents, and a crafted file can
 * make a converter emit arbitrarily much output. The buffer stops growing at
 * the cap and the child is killed, because continuing to read a process whose
 * output nobody wants is pure waste.
 */
function appendBounded(
    current: string,
    chunk: Buffer,
    capBytes: number
): { text: string; bytes: number; overflowed: boolean } {
    const currentBytes = Buffer.byteLength(current, 'utf8');
    if (currentBytes >= capBytes) {
        return { text: current, bytes: currentBytes, overflowed: true };
    }
    const remaining = capBytes - currentBytes;
    // Slice on a byte boundary, then repair a possible split multi-byte
    // character so the truncated string stays valid UTF-8.
    let piece = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
    let text = piece.toString('utf8');
    if (piece.length < chunk.length) {
        // Drop a trailing replacement character produced by a split sequence.
        if (text.endsWith('�')) {
            text = text.slice(0, -1);
        }
        return { text: current + text, bytes: capBytes, overflowed: true };
    }
    return { text: current + text, bytes: currentBytes + piece.length, overflowed: false };
}

export async function executeCommand(
    binary: string,
    args: string[],
    timeoutMs: number,
    cwd?: string
): Promise<CommandResult> {
    const maxOutputBytes = env.COMMAND_MAX_OUTPUT_BYTES;

    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, {
            cwd,
            shell: false,
            windowsHide: true,
        });

        let stdout = '';
        let stderr = '';
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let truncated = false;
        let killedByTimeout = false;
        let killedForOutput = false;

        const timeout = setTimeout(() => {
            killedByTimeout = true;
            child.kill('SIGKILL');
        }, timeoutMs);

        const killForOutput = (stream: 'stdout' | 'stderr') => {
            if (killedForOutput) return;
            killedForOutput = true;
            logger.warn(
                { binary, stream, capBytes: maxOutputBytes },
                'Command output exceeded COMMAND_MAX_OUTPUT_BYTES; terminating the process'
            );
            child.kill('SIGKILL');
        };

        child.stdout.on('data', (chunk: Buffer) => {
            const result = appendBounded(stdout, chunk, maxOutputBytes);
            stdout = result.text;
            stdoutBytes = result.bytes;
            if (result.overflowed) {
                truncated = true;
                killForOutput('stdout');
            }
        });

        child.stderr.on('data', (chunk: Buffer) => {
            const result = appendBounded(stderr, chunk, maxOutputBytes);
            stderr = result.text;
            stderrBytes = result.bytes;
            if (result.overflowed) {
                truncated = true;
                killForOutput('stderr');
            }
        });

        child.on('error', (error: NodeJS.ErrnoException) => {
            clearTimeout(timeout);
            // A missing/unlaunchable binary (e.g. ENOENT) should surface as a
            // process failure result so callers can fall back gracefully,
            // instead of throwing and aborting the whole job.
            if (error.code === 'ENOENT') {
                resolve({
                    code: 127,
                    stdout,
                    stderr: `Command not found: ${binary}`,
                    truncated,
                });
                return;
            }
            reject(error);
        });

        child.on('close', (code) => {
            clearTimeout(timeout);
            if (killedByTimeout) {
                reject(new Error(`Command timeout after ${timeoutMs}ms: ${binary} ${args.join(' ')}`));
                return;
            }
            // An output-cap kill is a failure, not a success with a short string:
            // the converter almost certainly did not finish writing its output
            // file, so returning code 0 would hand back a corrupt document.
            if (killedForOutput) {
                reject(
                    new Error(
                        `Command ${binary} produced more than ${maxOutputBytes} bytes of ` +
                            `output and was terminated (stdout ${stdoutBytes}B, stderr ${stderrBytes}B).`
                    )
                );
                return;
            }
            resolve({
                code: code ?? 1,
                stdout,
                stderr,
                truncated,
            });
        });
    });
}
