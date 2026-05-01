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

const sql = neon(connectionString || 'postgresql://localhost/pbl');

function toPostgres(query) {
  let i = 0;
  return query.replace(/\?/g, () => '$' + (++i));
}

function flatArgs(args) {
  if (!args || !args.length) return [];
  if (args.length === 1 && Array.isArray(args[0])) return args[0].map(n);
  return args.map(n);
}

function n(v) {
  return v === undefined ? null : v;
}

const db = {
  async get(query, ...args) {
    try {
      const rows = await sql.unsafe(toPostgres(query), flatArgs(args));
      return rows[0] || null;
    } catch (e) {
      console.error('db.get error:', e.message, '| SQL:', query);
      throw e;
    }
  },

  async all(query, ...args) {
    try {
      return await sql.unsafe(toPostgres(query), flatArgs(args));
    } catch (e) {
      console.error('db.all error:', e.message, '| SQL:', query);
      throw e;
    }
  },

  async run(query, ...args) {
    try {
      const isInsert = query.trim().toUpperCase().startsWith('INSERT');
      const pgQuery = toPostgres(query) + (isInsert ? ' RETURNING id' : '');
      const rows = await sql.unsafe(pgQuery, flatArgs(args));
      return { lastInsertRowid: rows[0]?.id || 0 };
    } catch (e) {
      console.error('db.run error:', e.message, '| SQL:', query);
      throw e;
    }
  },

  async transaction(fn) {
    await sql.transaction(async (tx) => {
      const client = {
        query: (q, params) => tx.unsafe(q, params || [])
      };
      await fn(client);
    });
  }
};

const SCHEMA = [
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
    await sql.unsafe('SELECT 1');

    for (const stmt of SCHEMA) {
      try { await sql.unsafe(stmt); } catch {}
    }

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
