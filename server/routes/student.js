const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware, requireRole('student'));

  router.get('/tasks', (req, res) => {
    res.json(db.prepare(`
      SELECT pt.*, p.title as project_title, p.deadline, p.description as project_desc,
        u.full_name as teacher_name
      FROM project_tasks pt
      JOIN projects p ON pt.project_id=p.id
      JOIN users u ON p.teacher_id=u.id
      WHERE pt.student_id=? ORDER BY pt.created_at DESC
    `).all(req.user.id));
  });

  router.post('/tasks/:taskId/submit', upload.single('file'), (req, res) => {
    const task = db.prepare('SELECT * FROM project_tasks WHERE id=? AND student_id=?').get(req.params.taskId, req.user.id);
    if (!task) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    if (task.status === 'graded') return res.status(400).json({ error: 'Baholangan vazifa qayta topshirilmaydi' });
    const filePath = req.file ? req.file.filename : task.file_path;
    db.prepare('UPDATE project_tasks SET status=?, file_path=?, submitted_at=datetime(\'now\') WHERE id=?').run('submitted', filePath, req.params.taskId);
    res.json({ success: true });
  });

  router.get('/my-chats', (req, res) => {
    res.json(db.prepare(`
      SELECT DISTINCT p.id, p.title FROM projects p
      JOIN project_tasks pt ON pt.project_id=p.id
      WHERE pt.student_id=?
    `).all(req.user.id));
  });

  router.get('/chat/:projectId', (req, res) => {
    const allowed = db.prepare('SELECT id FROM project_tasks WHERE project_id=? AND student_id=?').get(req.params.projectId, req.user.id);
    if (!allowed) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    res.json(db.prepare(`
      SELECT cm.*, u.full_name, u.role FROM chat_messages cm
      JOIN users u ON cm.user_id=u.id
      WHERE cm.project_id=? ORDER BY cm.created_at ASC
    `).all(req.params.projectId));
  });

  router.get('/stats', (req, res) => {
    const total = db.prepare('SELECT COUNT(*) as c FROM project_tasks WHERE student_id=?').get(req.user.id).c;
    const submitted = db.prepare('SELECT COUNT(*) as c FROM project_tasks WHERE student_id=? AND status=?').get(req.user.id, 'submitted').c;
    const graded = db.prepare('SELECT COUNT(*) as c FROM project_tasks WHERE student_id=? AND status=?').get(req.user.id, 'graded').c;
    const r = db.prepare('SELECT AVG(grade) as avg FROM project_tasks WHERE student_id=? AND grade IS NOT NULL').get(req.user.id);
    res.json({ total, submitted, graded, avg_grade: r.avg ? Math.round(r.avg * 10) / 10 : null });
  });

  return router;
};
