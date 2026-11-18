const mongoose = require('mongoose');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wraps async route handlers so rejected promises reach the error handler.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const MAX_LIMIT = 100;

// Parses ?page=&limit= into safe integers.
function getPagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || 10));
  return { page, limit, skip: (page - 1) * limit };
}

function paginated(items, { page, limit }, total) {
  return {
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 0 },
  };
}

function assertObjectId(id, label = 'id') {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, `Invalid ${label}`);
  return new mongoose.Types.ObjectId(String(id));
}

// --- tiny input validators (kept dependency-free on purpose) ---

function requireString(value, field, { min = 1, max = 1000 } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a string`);
  const v = value.trim();
  if (v.length < min) throw new HttpError(400, `${field} must be at least ${min} characters`);
  if (v.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return v;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireEmail(value) {
  const v = requireString(value, 'email', { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw new HttpError(400, 'email is invalid');
  return v;
}

function requirePassword(value) {
  return requireString(value, 'password', { min: 8, max: 128 });
}

function parseInterests(value) {
  if (!Array.isArray(value)) throw new HttpError(400, 'interests must be an array of strings');
  if (value.length > 20) throw new HttpError(400, 'at most 20 interests allowed');
  const cleaned = value.map((v) => requireString(v, 'interest', { max: 50 }).toLowerCase());
  return [...new Set(cleaned)];
}

module.exports = {
  HttpError,
  asyncHandler,
  getPagination,
  paginated,
  assertObjectId,
  requireString,
  requireEmail,
  requirePassword,
  parseInterests,
};
