import { withApiClient, withUserContext, workerPool } from '../db/client.js';

export interface CreateJobInput {
  userId?: string;           // null for anonymous jobs
  bullmqJobId?: string;
  jobType: 'conversion' | 'compression' | 'torrent';
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
}

export class JobService {

  async createJob(input: CreateJobInput): Promise<Job> {
    return withApiClient(async (client) => {
      const result = await client.query<Job>(`
        INSERT INTO jobs (
          user_id, bullmq_job_id, job_type, input_filename,
          input_size_bytes, input_format, output_format, conversion_type, options_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [
        input.userId ?? null,
        input.bullmqJobId ?? null,
        input.jobType,
        // Sanitize filename — strip path traversal
        input.inputFilename.replace(/[/\\<>:"|?*\x00-\x1f]/g, '_').slice(0, 512),
        input.inputSizeBytes ?? null,
        input.inputFormat ?? null,
        input.outputFormat ?? null,
        input.conversionType ?? null,
        input.optionsJson ? JSON.stringify(input.optionsJson) : null,
      ]);
      return result.rows[0];
    });
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

  // Called by worker to update job status — uses worker pool (bypasses RLS)
  async updateJobStatus(jobId: string, updates: {
    status?: string;
    progress?: number;
    outputFilename?: string;
    outputSizeBytes?: number;
    storagePath?: string;
    errorMessage?: string;
    downloadToken?: string;
    startedAt?: boolean;
    completedAt?: boolean;
    expiresAt?: Date;
  }): Promise<void> {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    const addParam = (clause: string, value: unknown) => {
      params.push(value);
      setClauses.push(`${clause} = $${params.length}`);
    };

    if (updates.status) addParam('status', updates.status);
    if (updates.progress !== undefined) addParam('progress', updates.progress);
    if (updates.outputFilename) addParam('output_filename', updates.outputFilename.slice(0, 512));
    if (updates.outputSizeBytes) addParam('output_size_bytes', updates.outputSizeBytes);
    if (updates.storagePath) addParam('storage_path', updates.storagePath);
    if (updates.errorMessage) addParam('error_message', updates.errorMessage.slice(0, 2000));
    if (updates.downloadToken) addParam('download_token', updates.downloadToken);
    if (updates.startedAt) addParam('started_at', new Date());
    if (updates.completedAt) addParam('completed_at', new Date());
    if (updates.expiresAt) addParam('expires_at', updates.expiresAt);

    if (setClauses.length === 0) return;
    
    params.push(jobId);
    await workerPool.query(
      `UPDATE jobs SET ${setClauses.join(', ')} WHERE id = $${params.length}`,
      params
    );
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
