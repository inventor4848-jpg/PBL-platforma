require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { ensureInit } = require('./database');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const uploadDir = process.env.VERCEL ? '/tmp' : path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadDir));

// DB init middleware
app.use(async (req, res, next) => {
  try {
    await ensureInit();
    next();
  } catch (e) {
    console.error('DB init error:', e);
    res.status(500).json({ error: 'Baza ulanmadi' });
  }
});

const { db } = require('./database');

app.use('/api/auth', require('./routes/auth')(db));
app.use('/api/admin', require('./routes/admin')(db));
app.use('/api/teacher', require('./routes/teacher')(db));
app.use('/api/student', require('./routes/student')(db));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Xatolik' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`PBL Platforma: http://localhost:${PORT}`);
    console.log(`Admin: 123123* / 123123*`);
  });
}

module.exports = app;
