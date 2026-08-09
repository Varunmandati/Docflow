import { withApiClient, withUserContext } from '../db/client.js';

export interface CreateJobInput {
  id?: string;               // explicit DB job id (== BullMQ job id when provided)
  userId?: string;           // Firebase UID — null for anonymous jobs
  bullmqJobId?: string;
  jobType: 'conversion' | 'compression' | 'upload';
  inputFilename: string;
  inputSizeBytes?: number;
  inputFormat?: string;
  outputFormat?: string;
  conversionType?: string;   // e.g. 'docx_to_pdf'
  optionsJson?: Record<string, unknown>;
}

export interface Job {
  id: string;
  user_id: string | null;
  bullmq_job_id: string | null;
  job_type: string;
  status: string;
  input_filename: string;
  output_filename: string | null;
  input_format: string | null;
  output_format: string | null;
  conversion_type: string | null;
  error_message: string | null;
  progress: number;
  queued_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  expires_at: Date | null;
  download_token: string | null;
  storage_path: string | null;
  output_size_bytes: number | null;
}

export class JobService {

  async createJob(input: CreateJobInput): Promise<Job> {
    const insert = async (client: any) => {
      const columns = [
        'user_id', 'bullmq_job_id', 'job_type', 'input_filename',
        'input_size_bytes', 'input_format', 'output_format', 'conversion_type', 'options_json',
      ];
      const values: unknown[] = [
        input.userId ?? null,
        input.bullmqJobId ?? input.id ?? null,
        input.jobType,
        // Sanitize filename — strip path traversal
        input.inputFilename.replace(/[/\\<>:"|?*\x00-\x1f]/g, '_').slice(0, 512),
        input.inputSizeBytes ?? null,
        input.inputFormat ?? null,
        input.outputFormat ?? null,
        input.conversionType ?? null,
        input.optionsJson ? JSON.stringify(input.optionsJson) : null,
      ];

      // Explicit id lets the DB row match the BullMQ job id (same uuid)
      if (input.id) {
        columns.unshift('id');
        values.unshift(input.id);
      }

      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const result = await client.query(
        `INSERT INTO jobs (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        values
      );
      return result.rows[0];
    };

    // RLS requires the user context to be set for authenticated inserts.
    if (input.userId) {
      return withUserContext(input.userId, insert);
    }
    return withApiClient(insert);
  }

  // Get job — RLS ensures user only gets their own if userId set
  async getJob(jobId: string, userId?: string): Promise<Job | null> {
    if (userId) {
      return withUserContext(userId, async (client) => {
        const result = await client.query<Job>(
          'SELECT * FROM jobs WHERE id = $1',
          [jobId]
        );
        return result.rows[0] ?? null;
      });
    }
    // Anonymous job lookup — using withApiClient
    return withApiClient(async (client) => {
      const result = await client.query<Job>(
        'SELECT * FROM jobs WHERE id = $1 AND user_id IS NULL',
        [jobId]
      );
      return result.rows[0] ?? null;
    });
  }

  // Get job by download token (public access)
  async getJobByDownloadToken(downloadToken: string): Promise<Job | null> {
    return withApiClient(async (client) => {
      const result = await client.query<Job>(`
        SELECT * FROM jobs 
        WHERE download_token = $1 
          AND status = 'completed'
          AND (expires_at IS NULL OR expires_at > NOW())
      `, [downloadToken]);
      return result.rows[0] ?? null;
    });
  }

  // Get user's job history — paginated
  async getUserHistory(userId: string, options: {
    limit?: number;
    offset?: number;
    status?: string;
    search?: string;
  } = {}): Promise<{ jobs: Job[]; total: number }> {
    const { limit = 20, offset = 0, status, search } = options;
    
    return withUserContext(userId, async (client) => {
      const params: unknown[] = [userId];
      let where = 'WHERE user_id = $1';
      
      if (status && ['completed', 'failed', 'queued', 'processing'].includes(status)) {
        params.push(status);
        where += ` AND status = $${params.length}`;
      }
      
      if (search) {
        // Parameterized LIKE — not string concatenation
        params.push(`%${search.replace(/[%_\\]/g, '\\$&')}%`);
        where += ` AND input_filename ILIKE $${params.length}`;
      }

      const [jobsResult, countResult] = await Promise.all([
        client.query<Job>(`
          SELECT id, user_id, job_type, status, input_filename, output_filename,
                 input_format, output_format, conversion_type, error_message,
                 progress, queued_at, started_at, completed_at, expires_at,
                 download_token, input_size_bytes, output_size_bytes
          FROM jobs ${where}
          ORDER BY queued_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `, [...params, limit, offset]),
        client.query<{ count: string }>(
          `SELECT COUNT(*)::text FROM jobs ${where}`,
          params
        ),
      ]);

      return {
        jobs: jobsResult.rows,
        total: parseInt(countResult.rows[0].count),
      };
    });
  }

  // Dashboard stats for user
  async getUserStats(userId: string): Promise<{
    total: number;
    successful: number;
    failed: number;
    successRate: number;
  }> {
    return withUserContext(userId, async (client) => {
      const result = await client.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS successful,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
        FROM jobs
        WHERE user_id = $1
      `, [userId]);
      
      const { total, successful, failed } = result.rows[0];
      return {
        total,
        successful,
        failed,
        successRate: total > 0 ? Math.round((successful / total) * 100) : 0,
      };
    });
  }
}

export const jobService = new JobService();
