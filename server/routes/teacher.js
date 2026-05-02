const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = process.env.VERCEL ? '/tmp' : path.join(__dirname, '../../uploads');
if (!process.env.VERCEL && !fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

module.exports = function (db) {
  const router = express.Router();
  router.use(authMiddleware, requireRole('teacher'));

  router.get('/dashboard', async (req, res) => {
    try {
      const tid = req.user.id;
      const [proj, total, submitted, graded] = await Promise.all([
        db.get('SELECT COUNT(*)::int as count FROM projects WHERE teacher_id=?', tid),
        db.get('SELECT COUNT(*)::int as count FROM project_tasks pt JOIN projects p ON pt.project_id=p.id WHERE p.teacher_id=?', tid),
        db.get("SELECT COUNT(*)::int as count FROM project_tasks pt JOIN projects p ON pt.project_id=p.id WHERE p.teacher_id=? AND pt.status='submitted'", tid),
        db.get("SELECT COUNT(*)::int as count FROM project_tasks pt JOIN projects p ON pt.project_id=p.id WHERE p.teacher_id=? AND pt.status='graded'", tid),
      ]);
      res.json({ projects: proj.count, tasks_total: total.count, tasks_submitted: submitted.count, tasks_graded: graded.count });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/projects', async (req, res) => {
    try {
      res.json(await db.all(`
        SELECT p.*, g.name as group_name,
          (SELECT COUNT(*)::int FROM project_tasks WHERE project_id=p.id) as task_count,
          (SELECT COUNT(*)::int FROM project_tasks WHERE project_id=p.id AND status='graded') as graded_count
        FROM projects p LEFT JOIN groups g ON p.group_id=g.id
        WHERE p.teacher_id=? ORDER BY p.created_at DESC
      `, req.user.id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/projects/:id', async (req, res) => {
    try {
      const project = await db.get(
        'SELECT p.*, g.name as group_name FROM projects p LEFT JOIN groups g ON p.group_id=g.id WHERE p.id=? AND p.teacher_id=?',
        req.params.id, req.user.id
      );
      if (!project) return res.status(404).json({ error: 'Topilmadi' });

      const [tasks, leaderboard] = await Promise.all([
        db.all(`SELECT pt.*, u.full_name as student_name FROM project_tasks pt JOIN users u ON pt.student_id=u.id WHERE pt.project_id=? ORDER BY u.full_name`, req.params.id),
        db.all(`
          SELECT u.full_name, u.id,
            COUNT(CASE WHEN pt.status='graded' THEN 1 END)::int as graded_tasks,
            ROUND(AVG(pt.grade)::numeric, 1) as avg_grade,
            COUNT(pt.id)::int as total_tasks
          FROM users u JOIN project_tasks pt ON pt.student_id=u.id
          WHERE pt.project_id=? GROUP BY u.id, u.full_name
          ORDER BY avg_grade DESC NULLS LAST, graded_tasks DESC
        `, req.params.id)
      ]);
      res.json({ project, tasks, leaderboard });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/projects/:id/tasks', async (req, res) => {
    try {
      const { student_id, title, description } = req.body;
      const project = await db.get('SELECT id FROM projects WHERE id=? AND teacher_id=?', req.params.id, req.user.id);
      if (!project) return res.status(403).json({ error: "Ruxsat yo'q" });
      if (!student_id || !title) return res.status(400).json({ error: 'Talaba va sarlavha kerak' });
      const r = await db.run('INSERT INTO project_tasks (project_id, student_id, title, description) VALUES (?,?,?,?)',
        req.params.id, student_id, title, description || null);
      res.json({ id: r.lastInsertRowid });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/projects/:id/assign-group', async (req, res) => {
    try {
      const { tasks } = req.body;
      const project = await db.get('SELECT * FROM projects WHERE id=? AND teacher_id=?', req.params.id, req.user.id);
      if (!project) return res.status(403).json({ error: "Ruxsat yo'q" });
      if (!project.group_id) return res.status(400).json({ error: 'Loyihaga guruh biriktirilmagan' });

      const students = await db.all("SELECT id FROM users WHERE group_id=? AND role='student'", project.group_id);
      if (!students.length) return res.status(400).json({ error: "Guruhda talabalar yo'q" });

      await db.transaction(async (client) => {
        for (let i = 0; i < students.length; i++) {
          const task = tasks[i % tasks.length];
          await client.query(
            'INSERT INTO project_tasks (project_id, student_id, title, description) VALUES (?,?,?,?)',
            [req.params.id, students[i].id, task.title, task.description || null]
          );
        }
      });
      res.json({ success: true, assigned: students.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/tasks/:taskId/grade', async (req, res) => {
    try {
      const { grade, feedback } = req.body;
      const task = await db.get(`
        SELECT pt.* FROM project_tasks pt JOIN projects p ON pt.project_id=p.id
        WHERE pt.id=? AND p.teacher_id=?
      `, req.params.taskId, req.user.id);
      if (!task) return res.status(403).json({ error: "Ruxsat yo'q" });
      await db.run('UPDATE project_tasks SET grade=?, feedback=?, status=?, graded_at=NOW() WHERE id=?',
        grade, feedback || null, 'graded', req.params.taskId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/groups/:groupId/students', async (req, res) => {
    try {
      res.json(await db.all("SELECT id, full_name FROM users WHERE group_id=? AND role='student'", req.params.groupId));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/chat/:projectId', async (req, res) => {
    try {
      const { last_id } = req.query;
      const project = await db.get('SELECT id FROM projects WHERE id=? AND teacher_id=?', req.params.projectId, req.user.id);
      if (!project) return res.status(403).json({ error: "Ruxsat yo'q" });
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
      const project = await db.get('SELECT id FROM projects WHERE id=? AND teacher_id=?', req.params.projectId, req.user.id);
      if (!project) return res.status(403).json({ error: "Ruxsat yo'q" });
      const r = await db.run('INSERT INTO chat_messages (project_id, user_id, message) VALUES (?,?,?)',
        req.params.projectId, req.user.id, message.trim());
      const saved = await db.get('SELECT cm.*, u.full_name, u.role FROM chat_messages cm JOIN users u ON cm.user_id=u.id WHERE cm.id=?', r.lastInsertRowid);
      res.json(saved);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/my-chats', async (req, res) => {
    try {
      res.json(await db.all('SELECT id, title FROM projects WHERE teacher_id=?', req.user.id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
