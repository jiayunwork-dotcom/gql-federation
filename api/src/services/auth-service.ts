import { query } from '../db';
import { AdminUser } from '../types';
import bcrypt from 'bcryptjs';

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  user: Omit<AdminUser, 'password_hash'>;
  token: string;
}

export async function login(email: string, password: string): Promise<AuthResult | null> {
  const result = await query<AdminUser>(
    'SELECT * FROM admin_users WHERE email = $1 AND is_active = true',
    [email.toLowerCase()]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const user = result.rows[0];
  const isValid = await bcrypt.compare(password, user.password_hash);

  if (!isValid) {
    return null;
  }

  await query(
    'UPDATE admin_users SET last_login_at = NOW() WHERE id = $1',
    [user.id]
  );

  const { password_hash: _, ...userWithoutPassword } = user;
  return {
    user: userWithoutPassword as Omit<AdminUser, 'password_hash'>,
    token: generateTokenFromUser(user),
  };
}

function generateTokenFromUser(user: AdminUser): string {
  const payload = JSON.stringify({ id: user.id, email: user.email, ts: Date.now() });
  return Buffer.from(payload).toString('base64url');
}

export async function getUserById(id: string): Promise<AdminUser | null> {
  const result = await query<AdminUser>(
    'SELECT * FROM admin_users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

export async function getUserByEmail(email: string): Promise<AdminUser | null> {
  const result = await query<AdminUser>(
    'SELECT * FROM admin_users WHERE email = $1',
    [email.toLowerCase()]
  );
  return result.rows[0] || null;
}

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  role: 'super_admin' | 'admin' | 'viewer';
}

export async function createUser(input: CreateUserInput): Promise<AdminUser> {
  const existing = await getUserByEmail(input.email);
  if (existing) {
    throw new Error('User with this email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  const result = await query<AdminUser>(
    `INSERT INTO admin_users (email, password_hash, name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.email.toLowerCase(), passwordHash, input.name, input.role]
  );

  return result.rows[0];
}

export function verifyToken(token: string): { valid: boolean; userId?: string; email?: string } {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const payload = JSON.parse(decoded);
    if (!payload.id || !payload.email) {
      return { valid: false };
    }
    return { valid: true, userId: payload.id, email: payload.email };
  } catch {
    return { valid: false };
  }
}

export async function ensureDefaultAdmin(): Promise<void> {
  const result = await query<AdminUser>(
    "SELECT * FROM admin_users WHERE email = 'admin@example.com'"
  );

  if (result.rows.length === 0) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await query(
      `INSERT INTO admin_users (email, password_hash, name, role, is_active)
       VALUES ('admin@example.com', $1, 'Super Admin', 'super_admin', true)
       ON CONFLICT (email) DO NOTHING`,
      [passwordHash]
    );
    console.log('Default admin user created');
  } else {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await query(
      'UPDATE admin_users SET password_hash = $1 WHERE email = $2',
      [passwordHash, 'admin@example.com']
    );
    console.log('Default admin password hash verified/updated');
  }
}

export default {
  login,
  getUserById,
  getUserByEmail,
  createUser,
  verifyToken,
  ensureDefaultAdmin,
};
