import { withUserContext, withApiClient } from '../db/client.js';

export type AuditEventType =
  | 'auth.otp_requested' | 'auth.otp_verified' | 'auth.otp_failed'
  | 'auth.login_success' | 'auth.login_failed' | 'auth.logout'
  | 'auth.token_refreshed' | 'auth.token_revoked'
  | 'auth.google_login' | 'auth.email_changed'
  | 'auth.register' | 'auth.login' | 'auth.email_verified' | 'auth.password_reset'
  | 'file.uploaded' | 'file.downloaded' | 'file.deleted'
  | 'job.created' | 'job.completed' | 'job.failed' | 'job.cancelled'
  | 'security.rate_limit_hit' | 'security.invalid_token' | 'security.csrf_violation'
  | 'admin.user_disabled';

export type AuditSeverity = 'info' | 'warn' | 'error' | 'critical';

export interface AuditEntry {
  userId?: string;
  eventType: AuditEventType;
  severity?: AuditSeverity;
  ipAddress?: string;
  userAgent?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

export class AuditService {

  // Fire-and-forget audit logging — never let audit failures block user requests.
  // Runs inside the user's RLS context so the api role can insert rows for that user.
  log(entry: AuditEntry): void {
    const safeMetadata = entry.metadata ? this.sanitizeMetadata(entry.metadata) : null;

    const run = (client: { query: (sql: string, params: unknown[]) => Promise<unknown> }) =>
      client.query(`
        INSERT INTO audit_logs (user_id, event_type, severity, ip_address, user_agent, resource_id, metadata)
        VALUES ($1, $2, $3, $4::inet, $5, $6, $7)
      `, [
        entry.userId ?? null,
        entry.eventType,
        entry.severity ?? 'info',
        entry.ipAddress ?? null,
        // Store only first 200 chars of user agent
        entry.userAgent?.slice(0, 200) ?? null,
        entry.resourceId ?? null,
        safeMetadata ? JSON.stringify(safeMetadata) : null,
      ]);

    const promise = entry.userId
      ? withUserContext(entry.userId, (client) => run(client))
      : withApiClient((client) => run(client));

    promise.catch((err) => {
      // Log to console only — don't throw, audit must not break requests
      console.error('[AUDIT] Failed to write audit log:', err.message);
    });
  }

  // Remove sensitive keys from metadata before storage
  private sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
    const BLOCKED_KEYS = ['password', 'token', 'secret', 'otp', 'key', 'auth', 'credential'];
    return Object.fromEntries(
      Object.entries(meta).filter(
        ([k]) => !BLOCKED_KEYS.some(blocked => k.toLowerCase().includes(blocked))
      )
    );
  }
}

export const auditService = new AuditService();
