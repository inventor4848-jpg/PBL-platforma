const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'pbl_secret_key_2024';

module.exports = function (db) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    try {
      const username = req.body.username?.trim();
      const password = req.body.password?.trim();
      if (!username || !password) return res.status(400).json({ error: 'Login va parol kerak' });

      const user = await db.get('SELECT * FROM users WHERE username = ?', username);
      if (!user) {
        console.warn(`Login failed: User not found [${username}]`);
        return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
      }

      const valid = bcrypt.compareSync(password, user.password);
      if (!valid) {
        console.warn(`Login failed: Wrong password for [${username}]`);
        return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
      }

      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
        JWT_SECRET, { expiresIn: '24h' }
      );
      res.json({ token, role: user.role, full_name: user.full_name, id: user.id });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
