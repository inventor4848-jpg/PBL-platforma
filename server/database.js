const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Parse bigint (COUNT returns) as JS number
const pg = require('pg');
pg.types.setTypeParser(20, parseInt);
pg.types.setTypeParser(1700, parseFloat);

// Vercel Neon integration uses POSTGRES_URL, manual setup uses DATABASE_URL
const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.NEON_DATABASE_URL;

if (!connectionString) {
  console.error('XATO: DATABASE_URL topilmadi! Vercel Environment Variables ga qoshing.');
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  max: 5
});

function toPostgres(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}

function norm(v) {
  return v === undefined ? null : v;
}

function flatArgs(args) {
  if (!args || args.length === 0) return [];
  if (args.length === 1 && Array.isArray(args[0])) return args[0].map(norm);
  return args.map(norm);
}

const db = {
  async get(sql, ...args) {
    const params = flatArgs(args);
    const { rows } = await pool.query(toPostgres(sql), params);
    return rows[0] || null;
  },
  async all(sql, ...args) {
    const params = flatArgs(args);
    const { rows } = await pool.query(toPostgres(sql), params);
    return rows;
  },
  async run(sql, ...args) {
    const params = flatArgs(args);
    const isInsert = sql.trim().toUpperCase().startsWith('INSERT');
    const pgSql = toPostgres(sql) + (isInsert ? ' RETURNING id' : '');
    const { rows, rowCount } = await pool.query(pgSql, params);
    return { lastInsertRowid: rows[0]?.id || 0, changes: rowCount };
  },
  async transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await fn(client);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },
  pool
};

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS faculties (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    faculty_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    department_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS users (
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
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    teacher_id INTEGER NOT NULL,
    group_id INTEGER,
    status TEXT DEFAULT 'active',
    deadline DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS project_tasks (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    grade INTEGER,
    feedback TEXT,
    file_path TEXT,
    submitted_at TIMESTAMPTZ,
    graded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`
];

let _initialized = false;

async function ensureInit() {
  if (_initialized) return;

  try {
    // Connection test
    await pool.query('SELECT 1');

    // Create tables
    for (const stmt of SCHEMA_STATEMENTS) {
      try { await pool.query(stmt); } catch {}
    }

    // Create default admin if not exists
    const admin = await db.get('SELECT id FROM users WHERE username = ?', '123123*');
    if (!admin) {
      const hash = bcrypt.hashSync('123123*', 10);
      await db.run(
        'INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
        '123123*', hash, 'Administrator', 'admin'
      );
      console.log('Admin yaratildi: 123123* / 123123*');
    }

    _initialized = true;
    console.log('DB tayyor.');
  } catch (e) {
    // Reset flag so next request retries
    _initialized = false;
    const msg = `DB ulanmadi: ${e.message}. DATABASE_URL=${connectionString ? 'mavjud' : 'YOQ'}`;
    console.error(msg);
    throw new Error(msg);
  }
}

module.exports = { db, ensureInit };
