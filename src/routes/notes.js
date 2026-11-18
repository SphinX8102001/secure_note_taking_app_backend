const express = require('express');
const Note = require('../models/Note');
const {
  HttpError,
  asyncHandler,
  getPagination,
  paginated,
  assertObjectId,
  requireString,
} = require('../utils/http');

const router = express.Router();

function parseNoteBody(body, { partial }) {
  const out = {};
  if (!partial || body.title !== undefined) out.title = requireString(body.title, 'title', { max: 200 });
  if (body.content !== undefined) {
    if (typeof body.content !== 'string') throw new HttpError(400, 'content must be a string');
    if (body.content.length > 20000) throw new HttpError(400, 'content is too long');
    out.content = body.content;
  }
  if (partial && Object.keys(out).length === 0) throw new HttpError(400, 'Nothing to update');
  return out;
}

// GET /api/notes?page=&limit=  - the caller's own notes, newest first.
// Index: { owner: 1, _id: -1 } (equality on owner + sort on _id, no in-memory sort).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const p = getPagination(req.query);
    const filter = { owner: req.user._id };
    const [items, total] = await Promise.all([
      Note.find(filter).sort({ _id: -1 }).skip(p.skip).limit(p.limit).lean(),
      Note.countDocuments(filter),
    ]);
    res.json(paginated(items, p, total));
  })
);

// GET /api/notes/:id  - owner can read their note; admin can read anyone's.
// Index: default { _id: 1 }.
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const _id = assertObjectId(req.params.id);
    const filter = req.user.role === 'admin' ? { _id } : { _id, owner: req.user._id };
    const note = await Note.findOne(filter).lean();
    if (!note) throw new HttpError(404, 'Note not found');
    res.json({ note });
  })
);

// POST /api/notes
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = parseNoteBody(req.body, { partial: false });
    const note = await Note.create({ ...data, owner: req.user._id });
    res.status(201).json({ note });
  })
);

// PATCH /api/notes/:id  - only the owner may modify (admins included: they
// "inherit user capabilities", i.e. manage their own notes; for others' notes
// they have read access).
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const _id = assertObjectId(req.params.id);
    const data = parseNoteBody(req.body, { partial: true });
    const note = await Note.findOneAndUpdate({ _id, owner: req.user._id }, data, {
      new: true,
      runValidators: true,
    }).lean();
    if (!note) throw new HttpError(404, 'Note not found');
    res.json({ note });
  })
);

// DELETE /api/notes/:id  - owner only.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const _id = assertObjectId(req.params.id);
    const result = await Note.deleteOne({ _id, owner: req.user._id });
    if (result.deletedCount === 0) throw new HttpError(404, 'Note not found');
    res.status(204).end();
  })
);

module.exports = router;
