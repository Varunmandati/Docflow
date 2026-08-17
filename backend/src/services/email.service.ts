/**
 * Shared email transporter for the entire backend.
 * Fixes:
 *  - Forces IPv4 DNS resolution (Gmail IPv6 hangs on Windows)
 *  - Uses port 587 STARTTLS (less likely to be firewall-blocked than 465)
 *  - Wraps sendMail in a hard timeout so requests never hang
 *  - Single transporter instance reused across all services
 */
import dns from 'dns';
import nodemailer from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer/index.js';
import { env } from '../config/env.js';

// Force IPv4 DNS resolution — Gmail's IPv6 addresses often hang on Windows
try {
    dns.setDefaultResultOrder('ipv4first');
    console.log('[Email] ✅ DNS forced to IPv4-first');
} catch {
    console.warn('[Email] ⚠️ Could not set DNS to IPv4-first (older Node?)');
}

// Build transporter — use the configured SMTP port.
// Port 465 typically implies implicit TLS (secure), 587 implies STARTTLS.
const smtpPort = env.SMTP_PORT || 587;
const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: smtpPort,
    secure: smtpPort === 465, // STARTTLS on 587/2525, implicit TLS on 465
    auth: {
        user: env.SMTP_USER.trim(),
        pass: env.SMTP_PASS.trim(),
    },
    tls: {
        rejectUnauthorized: false,
        // Force TLS 1.2 minimum
        minVersion: 'TLSv1.2',
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    // Disable connection pooling to avoid stale connections
    pool: false,
} as any);

// Verify on startup (non-blocking — just logs)
transporter.verify()
    .then(() => console.log(`[Email] ✅ SMTP verified successfully (user: ${env.SMTP_USER}, host: ${env.SMTP_HOST}:${smtpPort})`))
    .catch((err: Error) => console.error('[Email] ❌ SMTP verification FAILED:', err.message, '— emails will NOT send'));

/**
 * Send an email with a hard timeout.
 * If nodemailer hangs (firewall, DNS, etc.), this rejects after timeoutMs.
 */
export async function sendMailWithTimeout(
    mailOptions: Mail.Options,
    timeoutMs: number = 12000
): Promise<any> {
    return Promise.race([
        transporter.sendMail(mailOptions),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(
                `Email send timed out after ${timeoutMs / 1000}s. ` +
                `This usually means SMTP port 587 is blocked by your firewall/ISP. ` +
                `Check Windows Firewall settings or try a different network.`
            )), timeoutMs)
        ),
    ]);
}

export { transporter };
