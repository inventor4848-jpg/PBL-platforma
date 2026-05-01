const express = require('express');
const bcrypt = require('bcryptjs');
const { authMiddleware, requireRole } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware, requireRole('admin'));

  // Dashboard stats
  router.get('/stats', (req, res) => {
    const faculties = db.prepare('SELECT COUNT(*) as count FROM faculties').get().count;
    const departments = db.prepare('SELECT COUNT(*) as count FROM departments').get().count;
    const groups = db.prepare('SELECT COUNT(*) as count FROM groups').get().count;
    const teachers = db.prepare('SELECT COUNT(*) as count FROM users WHERE role=?').get('teacher').count;
    const students = db.prepare('SELECT COUNT(*) as count FROM users WHERE role=?').get('student').count;
    const projects = db.prepare('SELECT COUNT(*) as count FROM projects').get().count;
    const tasks_pending = db.prepare('SELECT COUNT(*) as count FROM project_tasks WHERE status=?').get('pending').count;
    const tasks_submitted = db.prepare('SELECT COUNT(*) as count FROM project_tasks WHERE status=?').get('submitted').count;
    const tasks_graded = db.prepare('SELECT COUNT(*) as count FROM project_tasks WHERE status=?').get('graded').count;
    res.json({ faculties, departments, groups, teachers, students, projects, tasks_pending, tasks_submitted, tasks_graded });
  });

  // Faculties
  router.get('/faculties', (req, res) => {
    res.json(db.prepare('SELECT * FROM faculties ORDER BY name').all());
  });
  router.post('/faculties', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Nomi kerak' });
    const r = db.prepare('INSERT INTO faculties (name) VALUES (?)').run(name);
    res.json({ id: r.lastInsertRowid, name });
  });
  router.put('/faculties/:id', (req, res) => {
    db.prepare('UPDATE faculties SET name=? WHERE id=?').run(req.body.name, req.params.id);
    res.json({ success: true });
  });
  router.delete('/faculties/:id', (req, res) => {
    db.prepare('DELETE FROM faculties WHERE id=?').run(req.params.id);
    res.json({ success: true });
  });

  // Departments
  router.get('/departments', (req, res) => {
    res.json(db.prepare('SELECT d.*, f.name as faculty_name FROM departments d JOIN faculties f ON d.faculty_id=f.id ORDER BY d.name').all());
  });
  router.post('/departments', (req, res) => {
    const { name, faculty_id } = req.body;
    if (!name || !faculty_id) return res.status(400).json({ error: 'Nomi va fakultet kerak' });
    const r = db.prepare('INSERT INTO departments (name, faculty_id) VALUES (?,?)').run(name, faculty_id);
    res.json({ id: r.lastInsertRowid, name, faculty_id });
  });
  router.put('/departments/:id', (req, res) => {
    db.prepare('UPDATE departments SET name=?, faculty_id=? WHERE id=?').run(req.body.name, req.body.faculty_id, req.params.id);
    res.json({ success: true });
  });
  router.delete('/departments/:id', (req, res) => {
    db.prepare('DELETE FROM departments WHERE id=?').run(req.params.id);
    res.json({ success: true });
  });

  // Groups
  router.get('/groups', (req, res) => {
    res.json(db.prepare('SELECT g.*, d.name as department_name, f.name as faculty_name FROM groups g JOIN departments d ON g.department_id=d.id JOIN faculties f ON d.faculty_id=f.id ORDER BY g.name').all());
  });
  router.post('/groups', (req, res) => {
    const { name, department_id } = req.body;
    if (!name || !department_id) return res.status(400).json({ error: 'Nomi va kafedra kerak' });
    const r = db.prepare('INSERT INTO groups (name, department_id) VALUES (?,?)').run(name, department_id);
    res.json({ id: r.lastInsertRowid, name, department_id });
  });
  router.put('/groups/:id', (req, res) => {
    db.prepare('UPDATE groups SET name=?, department_id=? WHERE id=?').run(req.body.name, req.body.department_id, req.params.id);
    res.json({ success: true });
  });
  router.delete('/groups/:id', (req, res) => {
    db.prepare('DELETE FROM groups WHERE id=?').run(req.params.id);
    res.json({ success: true });
  });

  // Users
  router.get('/users', (req, res) => {
    res.json(db.prepare(`
      SELECT u.id, u.username, u.full_name, u.role, u.created_at, u.group_id, u.department_id,
        g.name as group_name, d.name as department_name, f.name as faculty_name
      FROM users u
      LEFT JOIN groups g ON u.group_id=g.id
      LEFT JOIN departments d ON u.department_id=d.id
      LEFT JOIN faculties f ON u.faculty_id=f.id
      WHERE u.role != 'admin'
      ORDER BY u.role, u.full_name
    `).all());
  });
  router.post('/users', (req, res) => {
    const { username, password, full_name, role, group_id, department_id, faculty_id } = req.body;
    if (!username || !password || !full_name || !role) return res.status(400).json({ error: 'Barcha maydonlar kerak' });
    const existing = db.prepare('SELECT id FROM users WHERE username=?').get(username);
    if (existing) return res.status(400).json({ error: 'Bu login allaqachon mavjud' });
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare('INSERT INTO users (username, password, full_name, role, group_id, department_id, faculty_id) VALUES (?,?,?,?,?,?,?)').run(username, hash, full_name, role, group_id || null, department_id || null, faculty_id || null);
    res.json({ id: r.lastInsertRowid, username, full_name, role });
  });
  router.put('/users/:id', (req, res) => {
    const { full_name, password, group_id, department_id, faculty_id } = req.body;
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE users SET full_name=?, password=?, group_id=?, department_id=?, faculty_id=? WHERE id=?').run(full_name, hash, group_id || null, department_id || null, faculty_id || null, req.params.id);
    } else {
      db.prepare('UPDATE users SET full_name=?, group_id=?, department_id=?, faculty_id=? WHERE id=?').run(full_name, group_id || null, department_id || null, faculty_id || null, req.params.id);
    }
    res.json({ success: true });
  });
  router.delete('/users/:id', (req, res) => {
    db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
    res.json({ success: true });
  });

  // Projects
  router.get('/projects', (req, res) => {
    res.json(db.prepare(`
      SELECT p.*, u.full_name as teacher_name, g.name as group_name
      FROM projects p JOIN users u ON p.teacher_id=u.id
      LEFT JOIN groups g ON p.group_id=g.id
      ORDER BY p.created_at DESC
    `).all());
  });
  router.post('/projects', (req, res) => {
    const { title, description, teacher_id, group_id, deadline } = req.body;
    if (!title || !teacher_id) return res.status(400).json({ error: 'Sarlavha va o\'qituvchi kerak' });
    const r = db.prepare('INSERT INTO projects (title, description, teacher_id, group_id, deadline) VALUES (?,?,?,?,?)').run(title, description || null, teacher_id, group_id || null, deadline || null);
    res.json({ id: r.lastInsertRowid });
  });
  router.delete('/projects/:id', (req, res) => {
    db.prepare('DELETE FROM projects WHERE id=?').run(req.params.id);
    res.json({ success: true });
  });

  router.get('/teachers', (req, res) => {
    res.json(db.prepare('SELECT id, full_name FROM users WHERE role=?').all('teacher'));
  });

  return router;
};
