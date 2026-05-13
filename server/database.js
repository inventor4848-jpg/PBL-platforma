const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.NEON_DATABASE_URL;

if (!connectionString) {
  console.error('XATO: DATABASE_URL topilmadi!');
}

const sql = neon(connectionString || '');

// Convert "?" placeholders to tagged template call
function q(sqlFn, query, params) {
  const parts = query.split('?');
  Object.assign(parts, { raw: [...parts] });
  return sqlFn(parts, ...params);
}

function norm(args) {
  if (!args || !args.length) return [];
  if (args.length === 1 && Array.isArray(args[0])) return args[0].map(v => v === undefined ? null : v);
  return args.map(v => v === undefined ? null : v);
}

const db = {
  async get(query, ...args) {
    try {
      const rows = await q(sql, query, norm(args));
      return rows[0] || null;
    } catch (e) {
      console.error('db.get error:', e.message, '| SQL:', query);
      throw e;
    }
  },

  async all(query, ...args) {
    try {
      return await q(sql, query, norm(args));
    } catch (e) {
      console.error('db.all error:', e.message, '| SQL:', query);
      throw e;
    }
  },

  async run(query, ...args) {
    try {
      const isInsert = query.trim().toUpperCase().startsWith('INSERT');
      const fullQuery = isInsert ? query + ' RETURNING id' : query;
      const rows = await q(sql, fullQuery, norm(args));
      return { lastInsertRowid: rows[0]?.id || 0 };
    } catch (e) {
      console.error('db.run error:', e.message, '| SQL:', query);
      throw e;
    }
  },

  async transaction(fn) {
    // Neon serverless requires array of template queries for real transactions, 
    // replacing with a simple mock client that awaits sequentially 
    const client = {
      query: async (query, params = []) => q(sql, query, params.map(v => v === undefined ? null : v))
    };
    await fn(client);
  }
};

let _initialized = false;

async function ensureInit() {
  if (_initialized) return;
  try {
    await sql`SELECT 1`;

    // Check if users table AND all required columns exist
    const usersOk = await sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'password'
    `;

    const allTablesOk = await sql`
      SELECT COUNT(*) as cnt FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('users','faculties','departments','groups','projects','project_tasks','chat_messages')
    `;

    const tableCount = parseInt(allTablesOk[0]?.cnt || '0');

    if (!usersOk.length || tableCount < 7) {
      // Drop all tables in correct dependency order with CASCADE to avoid FK errors
      await sql`DROP TABLE IF EXISTS chat_messages CASCADE`;
      await sql`DROP TABLE IF EXISTS project_tasks CASCADE`;
      await sql`DROP TABLE IF EXISTS projects CASCADE`;
      await sql`DROP TABLE IF EXISTS users CASCADE`;
      await sql`DROP TABLE IF EXISTS groups CASCADE`;
      await sql`DROP TABLE IF EXISTS departments CASCADE`;
      await sql`DROP TABLE IF EXISTS faculties CASCADE`;
    }

    // Create tables (IF NOT EXISTS is safe to run every time)
    await sql`CREATE TABLE IF NOT EXISTS faculties (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS departments (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      faculty_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      department_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      group_id INTEGER,
      department_id INTEGER,
      faculty_id INTEGER,
      avatar TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      teacher_id INTEGER NOT NULL,
      group_id INTEGER,
      status TEXT DEFAULT 'active',
      deadline DATE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS project_tasks (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      grade INTEGER,
      feedback TEXT,
      file_path TEXT,
      original_filename TEXT,
      file_data TEXT,
      deadline DATE,
      submitted_at TIMESTAMPTZ,
      graded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    // Migration: add columns if missing
    await sql`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS original_filename TEXT`;
    await sql`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS file_data TEXT`;
    await sql`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS deadline DATE`;
    
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS faculty_id INTEGER`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id INTEGER`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS group_id INTEGER`;
    await sql`ALTER TABLE departments ADD COLUMN IF NOT EXISTS faculty_id INTEGER`;
    await sql`ALTER TABLE groups ADD COLUMN IF NOT EXISTS department_id INTEGER`;
    await sql`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS teacher_file_data TEXT`;
    await sql`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS teacher_filename TEXT`;

    await sql`CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    // Create admin if not exists
    const admin = await db.get('SELECT id FROM users WHERE username = ?', '123123*');
    if (!admin) {
      const hash = bcrypt.hashSync('123123*', 10);
      await db.run(
        'INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
        '123123*', hash, 'Administrator', 'admin'
      );
      console.log('Admin yaratildi.');
    }

    _initialized = true;
    console.log('DB tayyor.');
  } catch (e) {
    _initialized = false;
    console.error('DB xato:', e.message);
    throw new Error('Baza ulanmadi: ' + e.message);
  }
}

module.exports = { db, ensureInit };
