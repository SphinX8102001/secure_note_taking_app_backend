const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const config = require('./config');
const { authenticate, requireRole } = require('./middleware/auth');
const { HttpError } = require('./utils/http');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// Basic security headers (kept dependency-free).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// CORS: the frontend is hosted on a different origin. Auth uses a Bearer
// token (not cookies), so credentials are not needed.
const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use(
  cors({
    origin(origin, cb) {
      // Requests without an Origin header (curl, server-to-server) are allowed;
      // CORS only restricts browsers.
      if (!origin) return cb(null, true);
      const allowed = config.corsOrigins.length
        ? config.corsOrigins.includes(origin)
        : LOCALHOST_RE.test(origin);
      cb(null, allowed);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  })
);

app.use(express.json({ limit: '100kb' }));

app.get('/', (_req, res) => {
  res.json({ name: 'Secure Notes API', health: '/api/health' });
});

app.get('/api/health', (_req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded', db: dbUp ? 'up' : 'down' });
});

// Slow down password guessing / mass sign-ups (default 20 auth requests per 15 min per IP).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.authRateLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});

app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/me', authenticate, require('./routes/me'));
app.use('/api/notes', authenticate, require('./routes/notes'));
app.use('/api/posts', authenticate, require('./routes/posts'));
app.use('/api/interests', authenticate, require('./routes/interests'));
app.use('/api/admin', authenticate, requireRole('admin'), require('./routes/admin'));

app.use((_req, _res, next) => next(new HttpError(404, 'Not found')));

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
