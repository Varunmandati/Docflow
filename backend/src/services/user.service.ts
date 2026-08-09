import { withUserContext, withApiClient } from '../db/client.js';

export interface CreateUserInput {
  id: string;                // Firebase UID
  email: string;
  displayName?: string;
  authProvider?: 'email' | 'google';
  avatarUrl?: string;
}

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  auth_provider: string;
  email_verified: boolean;
  is_active: boolean;
  storage_used_bytes: number;
  last_login_at: Date | null;
  created_at: Date;
}

export class UserService {

  // Find user by Firebase UID
  async findByUid(uid: string): Promise<User | null> {
    return withApiClient(async (client) => {
      const result = await client.query<User>(
        'SELECT * FROM users WHERE id = $1',
        [uid]
      );
      return result.rows[0] ?? null;
    });
  }

  // Find user by email — used for email-change uniqueness checks
  async findByEmail(email: string): Promise<User | null> {
    return withApiClient(async (client) => {
      const result = await client.query<User>(
        'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
        [email.toLowerCase().trim()]
      );
      return result.rows[0] ?? null;
    });
  }

  /**
   * Upsert a user row keyed by Firebase UID. Idempotent — safe to call
   * on every authenticated request. Returns the persisted user.
   */
  async findOrCreateFirebaseUser(input: CreateUserInput): Promise<User> {
    return withApiClient(async (client) => {
      const result = await client.query<User>(`
        INSERT INTO users (id, email, display_name, avatar_url, auth_provider, email_verified, last_login_at)
        VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
        ON CONFLICT (id) DO UPDATE SET
          email            = COALESCE(EXCLUDED.email, users.email),
          display_name     = COALESCE(EXCLUDED.display_name, users.display_name),
          avatar_url       = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
          last_login_at    = NOW()
        RETURNING *
      `, [
        input.id,
        input.email.toLowerCase().trim(),
        input.displayName ?? null,
        input.avatarUrl ?? null,
        input.authProvider ?? 'email',
      ]);

      const user = result.rows[0];

      // Create default preferences if new user
      await client.query(
        `INSERT INTO user_preferences (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id]
      );

      return user;
    });
  }

  // Get profile — respects RLS (user can only get their own)
  async getProfile(userId: string): Promise<(User & { preferences: Record<string, any> }) | null> {
    return withUserContext(userId, async (client) => {
      const result = await client.query(`
        SELECT
          u.*,
          p.language, p.theme, p.accent_color, p.font_size, p.font_family,
          p.default_compression, p.auto_delete_files, p.email_notifications,
          p.output_folder_path, p.background_animation
        FROM users u
        LEFT JOIN user_preferences p ON p.user_id = u.id
        WHERE u.id = $1
      `, [userId]);

      if (!result.rows[0]) return null;

      const row = result.rows[0] as any;
      const {
        language, theme, accent_color, font_size, font_family,
        default_compression, auto_delete_files, email_notifications,
        output_folder_path, background_animation, ...userData
      } = row;

      return {
        ...userData,
        preferences: {
          language,
          theme,
          accent_color,
          font_size,
          font_family,
          default_compression,
          auto_delete_files,
          email_notifications,
          output_folder_path,
          background_animation
        }
      };
    });
  }
}

export const userService = new UserService();
