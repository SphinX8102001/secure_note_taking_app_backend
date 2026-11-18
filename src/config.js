require('dotenv').config();

const config = {
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/secure_notes',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  // Comma-separated list of frontend origins allowed to call the API,
  // e.g. "https://my-notes.vercel.app". When empty, only localhost origins
  // (any port) are allowed, which is what local development needs.
  corsOrigins: (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
  // Number of reverse proxies in front of the app (1 on Render), so rate
  // limiting sees the real client IP.
  trustProxy: Number(process.env.TRUST_PROXY) || 0,
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT) || 20,
};

if (!config.jwtSecret) {
  throw new Error('JWT_SECRET is not set. Copy .env.example to .env and set it.');
}

module.exports = config;
