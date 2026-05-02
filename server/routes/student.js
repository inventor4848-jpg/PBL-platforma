const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');

module.exports = function (db) {
  const router = express.Router();
  router.use(authMiddleware, requireRole('student'));

  router.get('/tasks', async (req, res) => {
    try {
      res.json(await db.all(`
        SELECT pt.*, p.title as project_title, p.deadline, p.description as project_desc,
          u.full_name as teacher_name
        FROM project_tasks pt
        JOIN projects p ON pt.project_id=p.id
        JOIN users u ON p.teacher_id=u.id
        WHERE pt.student_id=? ORDER BY pt.created_at DESC
      `, req.user.id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/tasks/:taskId/submit', async (req, res) => {
    try {
      const task = await db.get('SELECT * FROM project_tasks WHERE id=? AND student_id=?', req.params.taskId, req.user.id);
      if (!task) return res.status(403).json({ error: "Ruxsat yo'q" });
      if (task.status === 'graded') return res.status(400).json({ error: 'Baholangan vazifa qayta topshirilmaydi' });

      const { file_data, original_filename } = req.body || {};
      const newFileData = file_data || task.file_data;
      const newOriginalFilename = original_filename || task.original_filename;
      const newFilePath = file_data ? ('db_' + Date.now() + '_' + (original_filename || 'vazifa')) : task.file_path;

      await db.run(
        "UPDATE project_tasks SET status='submitted', file_path=?, original_filename=?, file_data=?, submitted_at=NOW() WHERE id=?",
        newFilePath, newOriginalFilename, newFileData, req.params.taskId
      );
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/my-chats', async (req, res) => {
    try {
      res.json(await db.all(`
        SELECT DISTINCT p.id, p.title FROM projects p
        JOIN project_tasks pt ON pt.project_id=p.id WHERE pt.student_id=?
      `, req.user.id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/chat/:projectId', async (req, res) => {
    try {
      const { last_id } = req.query;
      const allowed = await db.get('SELECT id FROM project_tasks WHERE project_id=? AND student_id=?', req.params.projectId, req.user.id);
      if (!allowed) return res.status(403).json({ error: "Ruxsat yo'q" });
      const sql = last_id
        ? 'SELECT cm.*, u.full_name, u.role FROM chat_messages cm JOIN users u ON cm.user_id=u.id WHERE cm.project_id=? AND cm.id>? ORDER BY cm.created_at ASC'
        : 'SELECT cm.*, u.full_name, u.role FROM chat_messages cm JOIN users u ON cm.user_id=u.id WHERE cm.project_id=? ORDER BY cm.created_at ASC';
      const msgs = last_id ? await db.all(sql, req.params.projectId, last_id) : await db.all(sql, req.params.projectId);
      res.json(msgs);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/chat/:projectId', async (req, res) => {
    try {
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ error: 'Xabar kerak' });
      const allowed = await db.get('SELECT id FROM project_tasks WHERE project_id=? AND student_id=?', req.params.projectId, req.user.id);
      if (!allowed) return res.status(403).json({ error: "Ruxsat yo'q" });
      const r = await db.run('INSERT INTO chat_messages (project_id, user_id, message) VALUES (?,?,?)',
        req.params.projectId, req.user.id, message.trim());
      const saved = await db.get('SELECT cm.*, u.full_name, u.role FROM chat_messages cm JOIN users u ON cm.user_id=u.id WHERE cm.id=?', r.lastInsertRowid);
      res.json(saved);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/stats', async (req, res) => {
    try {
      const [total, submitted, graded, avg] = await Promise.all([
        db.get('SELECT COUNT(*)::int as c FROM project_tasks WHERE student_id=?', req.user.id),
        db.get("SELECT COUNT(*)::int as c FROM project_tasks WHERE student_id=? AND status='submitted'", req.user.id),
        db.get("SELECT COUNT(*)::int as c FROM project_tasks WHERE student_id=? AND status='graded'", req.user.id),
        db.get('SELECT ROUND(AVG(grade)::numeric,1) as avg FROM project_tasks WHERE student_id=? AND grade IS NOT NULL', req.user.id),
      ]);
      res.json({ total: total.c, submitted: submitted.c, graded: graded.c, avg_grade: avg.avg });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
