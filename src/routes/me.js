const express = require('express');
const User = require('../models/User');
const { asyncHandler, requireString, parseInterests } = require('../utils/http');

const router = express.Router();

// GET /api/me  - current user's profile (loaded by auth middleware via _id).
router.get('/', (req, res) => {
  const { password, __v, ...user } = req.user;
  res.json({ user });
});

// PATCH /api/me  - users may change their own name and interests only.
router.patch(
  '/',
  asyncHandler(async (req, res) => {
    const update = {};
    if (req.body.name !== undefined) update.name = requireString(req.body.name, 'name', { max: 100 });
    if (req.body.interests !== undefined) update.interests = parseInterests(req.body.interests);

    const user = await User.findByIdAndUpdate(req.user._id, update, {
      new: true,
      runValidators: true,
    });
    res.json({ user });
  })
);

module.exports = router;
