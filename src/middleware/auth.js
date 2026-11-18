const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const config = require('../config');
const User = require('../models/User');
const { HttpError, asyncHandler } = require('../utils/http');

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256',
  });
}

// Verifies the Bearer token, then reloads the user by _id (default _id index)
// so a deleted user or a changed role takes effect immediately rather than
// when the token expires.
const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Missing bearer token');

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
  if (!mongoose.isValidObjectId(payload.sub)) throw new HttpError(401, 'Invalid token');

  const user = await User.findById(payload.sub).lean();
  if (!user) throw new HttpError(401, 'User no longer exists');

  req.user = user;
  next();
});

const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new HttpError(403, 'Forbidden'));
  }
  next();
};

module.exports = { signToken, authenticate, requireRole };
