const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'pbl.db');

function flattenParams(args) {
  if (!args || args.length === 0) return [];
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

class DBWrapper {
  constructor(sqlDb) {
    this._db = sqlDb;
    this._saveTimer = null;
  }

  prepare(sql) {
    return new StmtWrapper(this, sql);
  }

  exec(sql) {
    this._db.exec(sql);
    this._scheduleSave();
  }

  pragma(p) {
    try { this._db.run(`PRAGMA ${p}`); } catch {}
  }

  transaction(fn) {
    const self = this;
    return (...outerArgs) => {
      self._db.run('BEGIN');
      try {
        fn(...outerArgs);
        self._db.run('COMMIT');
      } catch (e) {
        self._db.run('ROLLBACK');
        throw e;
      }
      self._save();
    };
  }

  _save() {
    try {
      const data = this._db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch {}
  }

  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save(), 100);
  }
}

class StmtWrapper {
  constructor(dbw, sql) {
    this._dbw = dbw;
    this._sql = sql;
  }

  run(...args) {
    const params = flattenParams(args);
    this._dbw._db.run(this._sql, params.map(normalizeParam));
    const r = this._dbw._db.exec('SELECT last_insert_rowid() AS id');
    const lastInsertRowid = r[0]?.values[0]?.[0] || 0;
    this._dbw._scheduleSave();
    return { lastInsertRowid };
  }

  get(...args) {
    const params = flattenParams(args);
    const stmt = this._dbw._db.prepare(this._sql);
    try {
      stmt.bind(params.map(normalizeParam));
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  all(...args) {
    const params = flattenParams(args);
    const stmt = this._dbw._db.prepare(this._sql);
    const results = [];
    try {
      stmt.bind(params.map(normalizeParam));
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      return results;
    } finally {
      stmt.free();
    }
  }
}

function normalizeParam(v) {
  if (v === undefined) return null;
  return v;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS faculties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    faculty_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    department_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL,
    group_id INTEGER,
    department_id INTEGER,
    faculty_id INTEGER,
    avatar TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    teacher_id INTEGER NOT NULL,
    group_id INTEGER,
    status TEXT DEFAULT 'active',
    deadline DATE,
    created_at DATETIME DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS project_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    grade INTEGER,
    feedback TEXT,
    file_path TEXT,
    submitted_at DATETIME,
    graded_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
  );
`;

async function init() {
  const SQL = await initSqlJs();
  let sqlDb;
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    sqlDb = new SQL.Database(buffer);
  } else {
    sqlDb = new SQL.Database();
  }

  const db = new DBWrapper(sqlDb);

  SCHEMA.split(';').map(s => s.trim()).filter(Boolean).forEach(stmt => {
    try { sqlDb.run(stmt); } catch {}
  });
  db._save();

  const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('123123*');
  if (!admin) {
    const hash = bcrypt.hashSync('123123*', 10);
    db.prepare(`INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)`)
      .run('123123*', hash, 'Administrator', 'admin');
    console.log('Admin yaratildi: login=123123* parol=123123*');
  }

  console.log('Ma\'lumotlar bazasi tayyor.');
  return db;
}

module.exports = { init };
