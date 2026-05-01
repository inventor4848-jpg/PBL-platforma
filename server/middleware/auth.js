const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'pbl_secret_key_2024';

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token kerak' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token noto\'g\'ri' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Ruxsat yo\'q' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
