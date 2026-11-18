const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Note = require('../models/Note');
const Post = require('../models/Post');
const { BCRYPT_ROUNDS } = require('./auth');
const {
  HttpError,
  asyncHandler,
  getPagination,
  paginated,
  assertObjectId,
  requireString,
  requireEmail,
  requirePassword,
  parseInterests,
} = require('../utils/http');

const router = express.Router();

function parseRole(value) {
  if (!User.ROLES.includes(value)) throw new HttpError(400, `role must be one of ${User.ROLES.join(', ')}`);
  return value;
}

// ---------------------------------------------------------------- users

// GET /api/admin/users?page=&limit=  - newest first.
// Index: default { _id: 1 } (walked backwards for sort { _id: -1 }).
// estimatedDocumentCount() reads collection metadata, no scan at all.
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const p = getPagination(req.query);
    const [items, total] = await Promise.all([
      User.find({}).sort({ _id: -1 }).skip(p.skip).limit(p.limit).lean(),
      User.estimatedDocumentCount(),
    ]);
    items.forEach((u) => delete u.__v);
    res.json(paginated(items, p, total));
  })
);

// GET /api/admin/users/:id  - Index: default { _id: 1 }.
router.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const user = await User.findById(assertObjectId(req.params.id));
    if (!user) throw new HttpError(404, 'User not found');
    res.json({ user });
  })
);

// POST /api/admin/users  - admin may create users of any role.
router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const name = requireString(req.body.name, 'name', { max: 100 });
    const email = requireEmail(req.body.email);
    const password = requirePassword(req.body.password);
    const role = req.body.role === undefined ? 'user' : parseRole(req.body.role);
    const interests = req.body.interests ? parseInterests(req.body.interests) : [];

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({ name, email, password: hash, role, interests });
    res.status(201).json({ user });
  })
);

// PATCH /api/admin/users/:id
router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const _id = assertObjectId(req.params.id);
    const update = {};
    if (req.body.name !== undefined) update.name = requireString(req.body.name, 'name', { max: 100 });
    if (req.body.email !== undefined) update.email = requireEmail(req.body.email);
    if (req.body.interests !== undefined) update.interests = parseInterests(req.body.interests);
    if (req.body.role !== undefined) {
      update.role = parseRole(req.body.role);
      if (_id.equals(req.user._id) && update.role !== 'admin') {
        throw new HttpError(400, 'You cannot remove your own admin role');
      }
    }
    if (req.body.password !== undefined) {
      update.password = await bcrypt.hash(requirePassword(req.body.password), BCRYPT_ROUNDS);
    }
    if (Object.keys(update).length === 0) throw new HttpError(400, 'Nothing to update');

    const user = await User.findByIdAndUpdate(_id, update, { new: true, runValidators: true });
    if (!user) throw new HttpError(404, 'User not found');
    res.json({ user });
  })
);

// DELETE /api/admin/users/:id  - also removes the user's notes and posts.
// deleteMany({ owner }) / deleteMany({ author }) use the { owner, _id } and
// { author, _id } index prefixes.
router.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const _id = assertObjectId(req.params.id);
    if (_id.equals(req.user._id)) throw new HttpError(400, 'You cannot delete your own account');

    const result = await User.deleteOne({ _id });
    if (result.deletedCount === 0) throw new HttpError(404, 'User not found');
    await Promise.all([Note.deleteMany({ owner: _id }), Post.deleteMany({ author: _id })]);
    res.status(204).end();
  })
);

// ---------------------------------------------------------------- notes

// GET /api/admin/notes?page=&limit=  - everyone's notes, newest first.
// Index: default { _id: 1 }. Owner names resolved by populate -> one
// User.find({ _id: { $in: [...] } }) on the _id index.
router.get(
  '/notes',
  asyncHandler(async (req, res) => {
    const p = getPagination(req.query);
    const [items, total] = await Promise.all([
      Note.find({})
        .sort({ _id: -1 })
        .skip(p.skip)
        .limit(p.limit)
        .populate('owner', 'name email')
        .lean(),
      Note.estimatedDocumentCount(),
    ]);
    res.json(paginated(items, p, total));
  })
);

module.exports = router;
