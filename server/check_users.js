require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.NEON_DATABASE_URL;

const sql = neon(connectionString || '');

async function run() {
  try {
    const users = await sql`SELECT id, username, role FROM users`;
    console.log('Users found:', users);
  } catch (e) {
    console.error('Error fetching users:', e.message);
  }
}

run();
