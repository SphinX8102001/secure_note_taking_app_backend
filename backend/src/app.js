const path = require('path');
const express = require('express');
const { authenticate, requireRole } = require('./middleware/auth');
const { HttpError } = require('./utils/http');

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// Basic security headers (kept dependency-free).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/me', authenticate, require('./routes/me'));
app.use('/api/notes', authenticate, require('./routes/notes'));
app.use('/api/posts', authenticate, require('./routes/posts'));
app.use('/api/interests', authenticate, require('./routes/interests'));
app.use('/api/admin', authenticate, requireRole('admin'), require('./routes/admin'));

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

// Serve the minimal frontend (../frontend) from the same origin: one port, no CORS needed.
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err.code === 11000) return res.status(409).json({ error: 'Email is already registered' });
  if (err.name === 'ValidationError' || err.name === 'CastError') {
    return res.status(400).json({ error: err.message });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

module.exports = app;
