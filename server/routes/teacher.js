const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');

const GROQ_API_KEY = process.env.GROQ_API_KEY;

async function groqChat(messages) {
  const body = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages,
    temperature: 0.7,
    max_tokens: 2048
  });

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body
  });

  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error((json.error && json.error.message) || 'Groq server xatosi');
  }

  return json.choices[0].message.content;
}

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
        db.all(`SELECT pt.id, pt.project_id, pt.student_id, pt.title, pt.description, pt.status, pt.grade, pt.feedback, pt.file_path, pt.original_filename, pt.deadline, pt.submitted_at, pt.graded_at, pt.created_at, (pt.file_data IS NOT NULL OR pt.file_path IS NOT NULL) as has_file, u.full_name as student_name FROM project_tasks pt JOIN users u ON pt.student_id=u.id WHERE pt.project_id=? ORDER BY u.full_name`, req.params.id),
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
      const project = await db.get('SELECT id FROM projects WHERE id=? AND teacher_id=?', parseInt(req.params.id), parseInt(req.user.id));
      if (!project) return res.status(403).json({ error: "Ruxsat yo'q" });
      if (!student_id || !title) return res.status(400).json({ error: 'Talaba va sarlavha kerak' });
      const r = await db.run('INSERT INTO project_tasks (project_id, student_id, title, description) VALUES (?,?,?,?)',
        parseInt(req.params.id), student_id, title, description || null);
      res.json({ id: r.lastInsertRowid });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/tasks/:id', async (req, res) => {
    try {
      const { title, description, deadline } = req.body;
      const task = await db.get('SELECT pt.* FROM project_tasks pt JOIN projects p ON pt.project_id=p.id WHERE pt.id=? AND p.teacher_id=?', parseInt(req.params.id), parseInt(req.user.id));
      if (!task) return res.status(403).json({ error: "Ruxsat yo'q" });
      if (!title) return res.status(400).json({ error: 'Sarlavha kiritilmagan' });
      await db.run('UPDATE project_tasks SET title=?, description=?, deadline=? WHERE id=?', title, description || null, deadline || null, parseInt(req.params.id));
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/tasks/:id', async (req, res) => {
    try {
      const task = await db.get('SELECT pt.* FROM project_tasks pt JOIN projects p ON pt.project_id=p.id WHERE pt.id=? AND p.teacher_id=?', parseInt(req.params.id), parseInt(req.user.id));
      if (!task) return res.status(403).json({ error: "Ruxsat yo'q" });
      await db.run('DELETE FROM project_tasks WHERE id=?', parseInt(req.params.id));
      res.json({ success: true });
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

  // AI VAZIFA — PREVIEW (guruh a'zolari soniga qarab bosqichlarga ajratish)
  router.post('/projects/:id/ai-assign-preview', async (req, res) => {
    try {
      const project = await db.get(
        'SELECT p.*, g.name as group_name FROM projects p LEFT JOIN groups g ON p.group_id=g.id WHERE p.id=? AND p.teacher_id=?',
        parseInt(req.params.id), parseInt(req.user.id)
      );
      if (!project) return res.status(403).json({ error: "Ruxsat yo'q" });
      if (!project.group_id) return res.status(400).json({ error: 'Loyihaga guruh biriktirilmagan' });

      const students = await db.all(
        "SELECT id, full_name FROM users WHERE group_id=? AND role='student' ORDER BY full_name",
        project.group_id
      );
      if (!students.length) return res.status(400).json({ error: "Guruhda talabalar yo'q" });

      const n = students.length;
      const prompt = `Sen o'zbek tilida javob beruvchi ta'lim yordamchisisan.

Loyiha: "${project.title}"
${project.description ? `Loyiha tavsifi: ${project.description}` : ''}
Guruh: ${project.group_name || 'Guruh'}
Talabalar soni: ${n}

Ushbu loyihani ${n} ta bosqichga (har bir talaba uchun 1 ta bosqich) bo'l. 
Har bir bosqich aniq, bajarilishi mumkin bo'lgan vazifa bo'lishi kerak.
Bosqichlar mantiqiy ketma-ketlikda bo'lsin — avvalgi bosqich keyingisiga asos bo'lsin.

Faqat quyidagi JSON formatda javob ber, boshqa hech narsa yozma:
[
  {"title": "1-bosqich nomi", "description": "batafsil tavsif"},
  {"title": "2-bosqich nomi", "description": "batafsil tavsif"},
  ...
]`;

      const aiResponse = await groqChat([
        { role: 'user', content: prompt }
      ]);

      // Parse JSON from AI response
      let tasks = [];
      const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        tasks = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("AI javobni tahlil qilib bo'lmadi");
      }

      // Match tasks to students
      const assignments = students.map((student, i) => ({
        student_id: student.id,
        student_name: student.full_name,
        title: tasks[i % tasks.length].title,
        description: tasks[i % tasks.length].description
      }));

      res.json({ assignments, total: students.length });
    } catch (e) {
      console.error('AI assign error:', e.message);
      res.status(500).json({ error: 'AI xato: ' + e.message });
    }
  });

  // AI VAZIFA — TASDIQLASH (preview ni DB ga saqlash)
  router.post('/projects/:id/ai-assign-confirm', async (req, res) => {
    try {
      const { assignments, deadline } = req.body;
      const project = await db.get('SELECT id FROM projects WHERE id=? AND teacher_id=?', parseInt(req.params.id), parseInt(req.user.id));
      if (!project) return res.status(403).json({ error: "Ruxsat yo'q" });
      if (!assignments || !assignments.length) return res.status(400).json({ error: 'Vazifalar kerak' });

      await db.transaction(async (client) => {
        for (const a of assignments) {
          await client.query(
            'INSERT INTO project_tasks (project_id, student_id, title, description, deadline) VALUES (?,?,?,?,?)',
            [parseInt(req.params.id), a.student_id, a.title, a.description || null, deadline || null]
          );
        }
      });
      res.json({ success: true, assigned: assignments.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/tasks/:taskId/debug', async (req, res) => {
    try {
      const task = await db.get('SELECT * FROM project_tasks WHERE id=?', req.params.taskId);
      if (!task) return res.json({ error: "No task" });
      res.json({
        id: task.id,
        status: task.status,
        file_path: task.file_path,
        has_file_data: !!task.file_data,
        file_data_length: task.file_data ? task.file_data.length : 0,
        original_filename: task.original_filename
      });
    } catch (e) { res.json({ error: e.message }); }
  });

  // FAYL YUKLAB OLISH (o'qituvchi)
  router.get('/tasks/:taskId/download', async (req, res) => {
    try {
      const task = await db.get(`
        SELECT pt.*, p.teacher_id 
        FROM project_tasks pt 
        JOIN projects p ON pt.project_id=p.id 
        WHERE pt.id=? AND p.teacher_id=?
      `, req.params.taskId, req.user.id);
      if (!task) return res.status(403).json({ error: "Ruxsat yo'q" });

      // DB based file transfer
      if (task.file_data && task.file_data.length > 10) {
        let cleanBase64 = task.file_data.replace(/^data:.*?;base64,/, ''); // safety clear
        const buf = Buffer.from(cleanBase64, 'base64');
        const originalName = task.original_filename || task.file_path || 'vazifa';
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', buf.length);
        return res.end(buf);
      }

      if (!task.file_path) return res.status(404).json({ error: "Talaba fayl yuklamagan yoxud fayl bazaga yetib kelmagan" });

      // Fallback local FS
      const filePath = path.join(__dirname, '../../uploads', task.file_path);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Fayl vaqtinchalik xotiradan o'chgan (" + task.file_path + "). Talaba qayta yuklashi shart." });
      }

      const originalName = task.original_filename || task.file_path || 'vazifa';
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`);
      res.setHeader('Content-Type', 'application/octet-stream');
      fs.createReadStream(filePath).pipe(res);
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
