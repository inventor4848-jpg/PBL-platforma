const express = require('express');
const bcrypt = require('bcryptjs');
const { authMiddleware, requireRole } = require('../middleware/auth');

module.exports = function (db) {
  const router = express.Router();
  router.use(authMiddleware, requireRole('admin'));

  router.get('/stats', async (req, res) => {
    try {
      const [fac, dep, grp, tea, stu, proj, tp, ts, tg] = await Promise.all([
        db.get('SELECT COUNT(*)::int as count FROM faculties'),
        db.get('SELECT COUNT(*)::int as count FROM departments'),
        db.get('SELECT COUNT(*)::int as count FROM groups'),
        db.get("SELECT COUNT(*)::int as count FROM users WHERE role='teacher'"),
        db.get("SELECT COUNT(*)::int as count FROM users WHERE role='student'"),
        db.get('SELECT COUNT(*)::int as count FROM projects'),
        db.get("SELECT COUNT(*)::int as count FROM project_tasks WHERE status='pending'"),
        db.get("SELECT COUNT(*)::int as count FROM project_tasks WHERE status='submitted'"),
        db.get("SELECT COUNT(*)::int as count FROM project_tasks WHERE status='graded'"),
      ]);
      res.json({
        faculties: fac.count, departments: dep.count, groups: grp.count,
        teachers: tea.count, students: stu.count, projects: proj.count,
        tasks_pending: tp.count, tasks_submitted: ts.count, tasks_graded: tg.count
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Faculties
  router.get('/faculties', async (req, res) => {
    try { res.json(await db.all('SELECT * FROM faculties ORDER BY name')); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/faculties', async (req, res) => {
    try {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: 'Nomi kerak' });
      const r = await db.run('INSERT INTO faculties (name) VALUES (?)', name);
      res.json({ id: r.lastInsertRowid, name });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/faculties/:id', async (req, res) => {
    try {
      await db.run('UPDATE faculties SET name=? WHERE id=?', req.body.name, req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/faculties/:id', async (req, res) => {
    try {
      await db.run('DELETE FROM faculties WHERE id=?', req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Departments
  router.get('/departments', async (req, res) => {
    try {
      res.json(await db.all('SELECT d.*, f.name as faculty_name FROM departments d LEFT JOIN faculties f ON d.faculty_id=f.id ORDER BY d.name'));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/departments', async (req, res) => {
    try {
      const { name, faculty_id } = req.body;
      if (!name || !faculty_id) return res.status(400).json({ error: 'Nomi va fakultet kerak' });
      const r = await db.run('INSERT INTO departments (name, faculty_id) VALUES (?,?)', name, faculty_id);
      res.json({ id: r.lastInsertRowid, name, faculty_id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/departments/:id', async (req, res) => {
    try {
      await db.run('UPDATE departments SET name=?, faculty_id=? WHERE id=?', req.body.name, req.body.faculty_id, req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/departments/:id', async (req, res) => {
    try {
      await db.run('DELETE FROM departments WHERE id=?', req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Groups
  router.get('/groups', async (req, res) => {
    try {
      res.json(await db.all('SELECT g.*, d.name as department_name, f.name as faculty_name FROM groups g LEFT JOIN departments d ON g.department_id=d.id LEFT JOIN faculties f ON d.faculty_id=f.id ORDER BY g.name'));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/groups', async (req, res) => {
    try {
      const { name, department_id } = req.body;
      if (!name || !department_id) return res.status(400).json({ error: 'Nomi va kafedra kerak' });
      const r = await db.run('INSERT INTO groups (name, department_id) VALUES (?,?)', name, department_id);
      res.json({ id: r.lastInsertRowid, name, department_id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/groups/:id', async (req, res) => {
    try {
      await db.run('UPDATE groups SET name=?, department_id=? WHERE id=?', req.body.name, req.body.department_id, req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/groups/:id', async (req, res) => {
    try {
      await db.run('DELETE FROM groups WHERE id=?', req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Users
  router.get('/users', async (req, res) => {
    try {
      res.json(await db.all(`
        SELECT u.id, u.username, u.full_name, u.role, u.created_at, u.group_id, u.department_id,
          g.name as group_name, d.name as department_name, f.name as faculty_name
        FROM users u
        LEFT JOIN groups g ON u.group_id=g.id
        LEFT JOIN departments d ON u.department_id=d.id
        LEFT JOIN faculties f ON u.faculty_id=f.id
        WHERE u.role != 'admin' ORDER BY u.role, u.full_name
      `));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/users', async (req, res) => {
    try {
      const { username, password, full_name, role, group_id, department_id, faculty_id } = req.body;
      if (!username || !password || !full_name || !role) return res.status(400).json({ error: 'Barcha maydonlar kerak' });
      const existing = await db.get('SELECT id FROM users WHERE username=?', username);
      if (existing) return res.status(400).json({ error: 'Bu login allaqachon mavjud' });
      const hash = bcrypt.hashSync(password, 10);
      const r = await db.run(
        'INSERT INTO users (username, password, full_name, role, group_id, department_id, faculty_id) VALUES (?,?,?,?,?,?,?)',
        username, hash, full_name, role, group_id || null, department_id || null, faculty_id || null
      );
      res.json({ id: r.lastInsertRowid, username, full_name, role });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/users/:id', async (req, res) => {
    try {
      const { full_name, password, group_id, department_id, faculty_id } = req.body;
      if (password) {
        const hash = bcrypt.hashSync(password, 10);
        await db.run('UPDATE users SET full_name=?, password=?, group_id=?, department_id=?, faculty_id=? WHERE id=?',
          full_name, hash, group_id || null, department_id || null, faculty_id || null, req.params.id);
      } else {
        await db.run('UPDATE users SET full_name=?, group_id=?, department_id=?, faculty_id=? WHERE id=?',
          full_name, group_id || null, department_id || null, faculty_id || null, req.params.id);
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/users/:id', async (req, res) => {
    try {
      await db.run('DELETE FROM users WHERE id=?', req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Projects
  router.get('/projects', async (req, res) => {
    try {
      res.json(await db.all(`
        SELECT p.*, u.full_name as teacher_name, g.name as group_name
        FROM projects p JOIN users u ON p.teacher_id=u.id
        LEFT JOIN groups g ON p.group_id=g.id ORDER BY p.created_at DESC
      `));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/projects', async (req, res) => {
    try {
      const { title, description, teacher_id, group_id, deadline } = req.body;
      if (!title || !teacher_id) return res.status(400).json({ error: "Sarlavha va o'qituvchi kerak" });
      const r = await db.run('INSERT INTO projects (title, description, teacher_id, group_id, deadline) VALUES (?,?,?,?,?)',
        title, description || null, teacher_id, group_id || null, deadline || null);
      res.json({ id: r.lastInsertRowid });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/projects/:id', async (req, res) => {
    try {
      await db.run('DELETE FROM projects WHERE id=?', req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/teachers', async (req, res) => {
    try { res.json(await db.all("SELECT id, full_name FROM users WHERE role='teacher'")); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
