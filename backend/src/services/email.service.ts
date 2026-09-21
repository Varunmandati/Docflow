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
    auth: (env.SMTP_USER && env.SMTP_PASS) ? {
        user: env.SMTP_USER.trim(),
        pass: env.SMTP_PASS.trim(),
    } : undefined,
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

// Verify on startup (non-blocking — just logs) only when using SMTP transport
if (env.EMAIL_TRANSPORT === 'smtp' && env.SMTP_USER && env.SMTP_PASS) {
    transporter.verify()
        .then(() => console.log(`[Email] ✅ SMTP verified successfully (user: ${env.SMTP_USER}, host: ${env.SMTP_HOST}:${smtpPort})`))
        .catch((err: Error) => console.error('[Email] ❌ SMTP verification FAILED:', err.message, '— emails will NOT send'));
}

/**
 * Send an email with a hard timeout.
 * If sending hangs (network, DNS, etc.), this rejects after timeoutMs.
 */
export async function sendMailWithTimeout(
    mailOptions: Mail.Options,
    timeoutMs: number = 12000
): Promise<any> {
    if (env.EMAIL_TRANSPORT === 'resend') {
        const resendKey = env.RESEND_API_KEY;
        if (!resendKey) {
            throw new Error('RESEND_API_KEY is required for resend transport');
        }
        const from = env.EMAIL_FROM || (mailOptions.from as string) || env.SMTP_FROM || 'DocFlow <noreply@docflow.example.com>';

        const toList = Array.isArray(mailOptions.to)
            ? mailOptions.to.map(String)
            : typeof mailOptions.to === 'string'
            ? [mailOptions.to]
            : [];

        const body: Record<string, any> = {
            from,
            to: toList,
            subject: mailOptions.subject || '',
        };
        if (mailOptions.html) body.html = mailOptions.html;
        if (mailOptions.text) body.text = mailOptions.text;

        return Promise.race([
            fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${resendKey}`,
                },
                body: JSON.stringify(body),
            }).then(async (res) => {
                if (!res.ok) {
                    const errorText = await res.text().catch(() => '');
                    throw new Error(`Resend API error (${res.status}): ${errorText}`);
                }
                return res.json();
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(
                    `Email send timed out (Resend HTTPS) after ${timeoutMs / 1000}s.`
                )), timeoutMs)
            ),
        ]);
    }

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
