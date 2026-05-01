require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'pbl_secret_key_2024';

async function main() {
  const { init } = require('./database');
  const db = await init();

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api/admin', require('./routes/admin')(db));
  app.use('/api/teacher', require('./routes/teacher')(db));
  app.use('/api/student', require('./routes/student')(db));

  // Socket.io for chat
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Auth required'));
    try {
      socket.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('join-project', (projectId) => {
      socket.join(`project-${projectId}`);
    });

    socket.on('send-message', ({ projectId, message }) => {
      if (!message?.trim()) return;
      const r = db.prepare('INSERT INTO chat_messages (project_id, user_id, message) VALUES (?,?,?)').run(projectId, socket.user.id, message.trim());
      const saved = db.prepare('SELECT cm.*, u.full_name, u.role FROM chat_messages cm JOIN users u ON cm.user_id=u.id WHERE cm.id=?').get(r.lastInsertRowid);
      io.to(`project-${projectId}`).emit('new-message', saved);
    });
  });

  app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
  app.get('/teacher.html', (req, res) => res.sendFile(path.join(__dirname, '../public/teacher.html')));
  app.get('/student.html', (req, res) => res.sendFile(path.join(__dirname, '../public/student.html')));

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`\nPBL Platforma ishga tushdi!`);
    console.log(`URL: http://localhost:${PORT}`);
    console.log(`Admin login: 123123*  |  Admin parol: 123123*\n`);
  });
}

main().catch(err => {
  console.error('Server xatosi:', err);
  process.exit(1);
});
