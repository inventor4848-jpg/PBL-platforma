require('dotenv').config();
const { db, ensureInit } = require('./server/database.js');

async function main() {
  await ensureInit();
  const facs = await db.all('SELECT * FROM faculties ORDER BY name');
  console.log('Faculties:', facs);
  
  const stats = await db.get('SELECT COUNT(*)::int as count FROM faculties');
  console.log('Stats:', stats);
}
main().catch(console.error);
