import { withUserContext, withApiClient } from '../db/client.js';

export interface CreateUserInput {
  email: string;
  displayName?: string;
  authProvider: 'email' | 'google';
  googleUid?: string;
  avatarUrl?: string;
}

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  auth_provider: string;
  google_uid: string | null;
  email_verified: boolean;
  is_active: boolean;
  storage_used_bytes: number;
  last_login_at: Date | null;
  created_at: Date;
}

export class UserService {
  
  // Find user by email — used during auth (no user context needed yet)
  async findByEmail(email: string): Promise<User | null> {
    return withApiClient(async (client) => {
      const result = await client.query<User>(
        'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
        [email.toLowerCase().trim()]
      );
      return result.rows[0] ?? null;
    });
  }

  // Find user by Google UID
  async findByGoogleUid(googleUid: string): Promise<User | null> {
    return withApiClient(async (client) => {
      const result = await client.query<User>(
        'SELECT * FROM users WHERE google_uid = $1 AND is_active = TRUE',
        [googleUid]
      );
      return result.rows[0] ?? null;
    });
  }

  // Find or create user (for Google OAuth)
  async findOrCreateGoogleUser(input: {
    googleUid: string;
    email: string;
    displayName?: string;
    avatarUrl?: string;
  }): Promise<User> {
    return withApiClient(async (client) => {
      const result = await client.query<User>(`
        INSERT INTO users (email, display_name, avatar_url, auth_provider, google_uid, email_verified)
        VALUES ($1, $2, $3, 'google', $4, TRUE)
        ON CONFLICT (google_uid) DO UPDATE SET
          display_name = COALESCE(EXCLUDED.display_name, users.display_name),
          avatar_url   = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
          last_login_at = NOW()
        RETURNING *
      `, [input.email, input.displayName, input.avatarUrl, input.googleUid]);
      
      // Create default preferences if new user
      await client.query(`
        INSERT INTO user_preferences (user_id) VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
      `, [result.rows[0].id]);
      
      return result.rows[0];
    });
  }

  // Create email user
  async createEmailUser(email: string, displayName?: string): Promise<User> {
    return withApiClient(async (client) => {
      const result = await client.query<User>(`
        INSERT INTO users (email, display_name, auth_provider, email_verified)
        VALUES ($1, $2, 'email', FALSE)
        RETURNING *
      `, [email.toLowerCase().trim(), displayName]);
      
      await client.query(
        'INSERT INTO user_preferences (user_id) VALUES ($1)',
        [result.rows[0].id]
      );
      
      return result.rows[0];
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
      
      // Shape it so preferences matches what the client expects
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

  // Update display name — RLS ensures users can only update themselves
  async updateDisplayName(userId: string, displayName: string): Promise<void> {
    // Input validation: strip HTML, limit length
    const sanitized = displayName.replace(/<[^>]*>/g, '').trim().slice(0, 128);
    await withUserContext(userId, async (client) => {
      await client.query(
        'UPDATE users SET display_name = $1 WHERE id = $2',
        [sanitized, userId]
      );
    });
  }

  // Update preferences
  async updatePreferences(userId: string, prefs: Partial<{
    language: string;
    theme: string;
    accent_color: string;
    font_size: string;
    font_family: string;
    default_compression: string;
    auto_delete_files: boolean;
    email_notifications: boolean;
    output_folder_path: string;
    background_animation: boolean;
  }>): Promise<void> {
    // Whitelist allowed values to prevent injection
    const allowedThemes = ['light', 'dark', 'system'];
    const allowedAccents = ['ember', 'indigo', 'teal', 'violet', 'navy'];
    const allowedFontSizes = ['small', 'medium', 'large'];
    const allowedCompression = ['low', 'medium', 'high'];
    
    if (prefs.theme && !allowedThemes.includes(prefs.theme)) throw new Error('Invalid theme');
    if (prefs.accent_color && !allowedAccents.includes(prefs.accent_color)) throw new Error('Invalid accent');
    if (prefs.font_size && !allowedFontSizes.includes(prefs.font_size)) throw new Error('Invalid font size');
    if (prefs.default_compression && !allowedCompression.includes(prefs.default_compression)) throw new Error('Invalid compression');
    
    await withUserContext(userId, async (client) => {
      const keys = Object.keys(prefs);
      if (keys.length === 0) return;
      
      await client.query(`
        INSERT INTO user_preferences (user_id, ${keys.join(', ')})
        VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
        ON CONFLICT (user_id) DO UPDATE SET
          ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')},
          updated_at = NOW()
      `, [userId, ...Object.values(prefs)]);
    });
  }

  // Mark email as verified
  async markEmailVerified(userId: string): Promise<void> {
    await withApiClient(async (client) => {
      await client.query(
        'UPDATE users SET email_verified = TRUE, last_login_at = NOW() WHERE id = $1',
        [userId]
      );
    });
  }

  // Soft-delete user (GDPR compliance — never hard delete)
  async deactivateUser(userId: string): Promise<void> {
    await withUserContext(userId, async (client) => {
      // Anonymize PII, keep audit trail
      await client.query(`
        UPDATE users SET
          is_active = FALSE,
          email = 'deleted_' || id || '@deleted.invalid',
          display_name = 'Deleted User',
          avatar_url = NULL,
          google_uid = NULL
        WHERE id = $1
      `, [userId]);
      // Revoke all refresh tokens
      await client.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1',
        [userId]
      );
    });
  }

  // Update storage usage (called after each job)
  async addStorageUsage(userId: string, bytes: number): Promise<void> {
    await withApiClient(async (client) => {
      await client.query(
        'UPDATE users SET storage_used_bytes = storage_used_bytes + $1 WHERE id = $2',
        [bytes, userId]
      );
    });
  }
}

export const userService = new UserService();
