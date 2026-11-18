const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const {
  HttpError,
  asyncHandler,
  requireString,
  requireEmail,
  requirePassword,
  parseInterests,
} = require('../utils/http');

const router = express.Router();
const BCRYPT_ROUNDS = 12;

// A hash compared against when the email doesn't exist, so login takes about
// the same time whether or not the account exists (avoids user enumeration).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

// POST /api/auth/register  - public sign-up; always creates role "user".
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const name = requireString(req.body.name, 'name', { max: 100 });
    const email = requireEmail(req.body.email);
    const password = requirePassword(req.body.password);
    const interests = req.body.interests ? parseInterests(req.body.interests) : [];

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    // Uniqueness is enforced by the unique { email } index (duplicate key -> 409).
    const user = await User.create({ name, email, password: hash, interests, role: 'user' });

    res.status(201).json({ token: signToken(user), user });
  })
);

// POST /api/auth/login  - uses the { email } unique index.
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const email = requireEmail(req.body.email);
    const password = requireString(req.body.password, 'password', { max: 128 });

    const user = await User.findOne({ email }).select('+password');
    const ok = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'Invalid email or password');

    res.json({ token: signToken(user), user });
  })
);

module.exports = router;
module.exports.BCRYPT_ROUNDS = BCRYPT_ROUNDS;
