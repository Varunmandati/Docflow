import { spawn } from 'child_process';

export interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}

export async function executeCommand(
    binary: string,
    args: string[],
    timeoutMs: number,
    cwd?: string
): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, {
            cwd,
            shell: false,
            windowsHide: true,
        });

        let stdout = '';
        let stderr = '';
        let killedByTimeout = false;

        const timeout = setTimeout(() => {
            killedByTimeout = true;
            child.kill('SIGKILL');
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
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
            resolve({
                code: code ?? 1,
                stdout,
                stderr,
            });
        });
    });
}
