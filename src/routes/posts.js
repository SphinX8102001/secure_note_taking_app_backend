const express = require('express');
const User = require('../models/User');
const Post = require('../models/Post');
const { userPostsPipeline } = require('../services/aggregations');
const {
  HttpError,
  asyncHandler,
  getPagination,
  paginated,
  assertObjectId,
  requireString,
} = require('../utils/http');

const router = express.Router();

// GET /api/posts?page=&limit=  - public feed (visible to every signed-in user).
// Index: default { _id: 1 }; authors resolved by populate on users._id.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const p = getPagination(req.query);
    const [items, total] = await Promise.all([
      Post.find({}).sort({ _id: -1 }).skip(p.skip).limit(p.limit).populate('author', 'name').lean(),
      Post.estimatedDocumentCount(),
    ]);
    res.json(paginated(items, p, total));
  })
);

// GET /api/posts/user/:userId?page=&limit=
// Scenario 2: single aggregation pipeline with $lookup (see services/aggregations.js).
router.get(
  '/user/:userId',
  asyncHandler(async (req, res) => {
    const userId = assertObjectId(req.params.userId, 'userId');
    const p = getPagination(req.query);

    const [result] = await User.aggregate(userPostsPipeline({ userId, skip: p.skip, limit: p.limit }));
    if (!result) throw new HttpError(404, 'User not found');

    const hasMore = result.posts.length > p.limit;
    res.json({
      user: { _id: result._id, name: result.name, interests: result.interests },
      data: result.posts.slice(0, p.limit),
      pagination: { page: p.page, limit: p.limit, hasMore },
    });
  })
);

// POST /api/posts
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const title = requireString(req.body.title, 'title', { max: 200 });
    let body = '';
    if (req.body.body !== undefined) {
      if (typeof req.body.body !== 'string' || req.body.body.length > 20000) {
        throw new HttpError(400, 'body must be a string of at most 20000 characters');
      }
      body = req.body.body;
    }
    const post = await Post.create({ author: req.user._id, title, body });
    res.status(201).json({ post });
  })
);

// DELETE /api/posts/:id  - author or admin. Index: default { _id: 1 }.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const _id = assertObjectId(req.params.id);
    const filter = req.user.role === 'admin' ? { _id } : { _id, author: req.user._id };
    const result = await Post.deleteOne(filter);
    if (result.deletedCount === 0) throw new HttpError(404, 'Post not found');
    res.status(204).end();
  })
);

module.exports = router;
