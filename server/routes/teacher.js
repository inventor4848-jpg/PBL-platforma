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
const upload = multer({ storage });

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware, requireRole('teacher'));

  router.get('/dashboard', (req, res) => {
    const tid = req.user.id;
    const projects = db.prepare('SELECT COUNT(*) as count FROM projects WHERE teacher_id=?').get(tid).count;
    const tasks_total = db.prepare('SELECT COUNT(*) as count FROM project_tasks pt JOIN projects p ON pt.project_id=p.id WHERE p.teacher_id=?').get(tid).count;
    const tasks_submitted = db.prepare('SELECT COUNT(*) as count FROM project_tasks pt JOIN projects p ON pt.project_id=p.id WHERE p.teacher_id=? AND pt.status=?').get(tid, 'submitted').count;
    const tasks_graded = db.prepare('SELECT COUNT(*) as count FROM project_tasks pt JOIN projects p ON pt.project_id=p.id WHERE p.teacher_id=? AND pt.status=?').get(tid, 'graded').count;
    res.json({ projects, tasks_total, tasks_submitted, tasks_graded });
  });

  router.get('/projects', (req, res) => {
    res.json(db.prepare(`
      SELECT p.*, g.name as group_name,
        (SELECT COUNT(*) FROM project_tasks WHERE project_id=p.id) as task_count,
        (SELECT COUNT(*) FROM project_tasks WHERE project_id=p.id AND status='graded') as graded_count
      FROM projects p LEFT JOIN groups g ON p.group_id=g.id
      WHERE p.teacher_id=? ORDER BY p.created_at DESC
    `).all(req.user.id));
  });

  router.get('/projects/:id', (req, res) => {
    const project = db.prepare('SELECT p.*, g.name as group_name FROM projects p LEFT JOIN groups g ON p.group_id=g.id WHERE p.id=? AND p.teacher_id=?').get(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Topilmadi' });

    const tasks = db.prepare(`
      SELECT pt.*, u.full_name as student_name
      FROM project_tasks pt JOIN users u ON pt.student_id=u.id
      WHERE pt.project_id=? ORDER BY u.full_name
    `).all(req.params.id);

    const leaderboard = db.prepare(`
      SELECT u.full_name, u.id,
        COUNT(CASE WHEN pt.status='graded' THEN 1 ELSE NULL END) as graded_tasks,
        AVG(CASE WHEN pt.grade IS NOT NULL THEN pt.grade ELSE NULL END) as avg_grade,
        COUNT(pt.id) as total_tasks
      FROM users u JOIN project_tasks pt ON pt.student_id=u.id
      WHERE pt.project_id=?
      GROUP BY u.id
      ORDER BY avg_grade DESC, graded_tasks DESC
    `).all(req.params.id);

    res.json({ project, tasks, leaderboard });
  });

  router.post('/projects/:id/tasks', (req, res) => {
    const { student_id, title, description } = req.body;
    const project = db.prepare('SELECT id FROM projects WHERE id=? AND teacher_id=?').get(req.params.id, req.user.id);
    if (!project) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    if (!student_id || !title) return res.status(400).json({ error: 'Talaba va sarlavha kerak' });
    const r = db.prepare('INSERT INTO project_tasks (project_id, student_id, title, description) VALUES (?,?,?,?)').run(req.params.id, student_id, title, description || null);
    res.json({ id: r.lastInsertRowid });
  });

  router.post('/projects/:id/assign-group', (req, res) => {
    const { tasks } = req.body;
    const project = db.prepare('SELECT * FROM projects WHERE id=? AND teacher_id=?').get(req.params.id, req.user.id);
    if (!project) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    if (!project.group_id) return res.status(400).json({ error: 'Loyihaga guruh biriktirilmagan' });

    const students = db.prepare('SELECT id FROM users WHERE group_id=? AND role=?').all(project.group_id, 'student');
    if (students.length === 0) return res.status(400).json({ error: 'Guruhda talabalar yo\'q' });

    const insert = db.prepare('INSERT INTO project_tasks (project_id, student_id, title, description) VALUES (?,?,?,?)');
    db._db.run('BEGIN');
    try {
      for (let i = 0; i < students.length; i++) {
        const task = tasks[i % tasks.length];
        insert.run(req.params.id, students[i].id, task.title, task.description || null);
      }
      db._db.run('COMMIT');
      db._scheduleSave();
    } catch(e) {
      db._db.run('ROLLBACK');
      throw e;
    }
    res.json({ success: true, assigned: students.length });
  });

  router.put('/tasks/:taskId/grade', (req, res) => {
    const { grade, feedback } = req.body;
    const task = db.prepare(`
      SELECT pt.* FROM project_tasks pt JOIN projects p ON pt.project_id=p.id
      WHERE pt.id=? AND p.teacher_id=?
    `).get(req.params.taskId, req.user.id);
    if (!task) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    db.prepare('UPDATE project_tasks SET grade=?, feedback=?, status=?, graded_at=datetime(\'now\') WHERE id=?').run(grade, feedback || null, 'graded', req.params.taskId);
    res.json({ success: true });
  });

  router.get('/groups/:groupId/students', (req, res) => {
    res.json(db.prepare('SELECT id, full_name FROM users WHERE group_id=? AND role=?').all(req.params.groupId, 'student'));
  });

  router.get('/chat/:projectId', (req, res) => {
    const project = db.prepare('SELECT id FROM projects WHERE id=? AND teacher_id=?').get(req.params.projectId, req.user.id);
    if (!project) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    res.json(db.prepare(`
      SELECT cm.*, u.full_name, u.role FROM chat_messages cm
      JOIN users u ON cm.user_id=u.id
      WHERE cm.project_id=? ORDER BY cm.created_at ASC
    `).all(req.params.projectId));
  });

  router.get('/my-chats', (req, res) => {
    res.json(db.prepare('SELECT id, title FROM projects WHERE teacher_id=?').all(req.user.id));
  });

  return router;
};
