const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, default: '', maxlength: 20000 },
  },
  { timestamps: true }
);

/*
 * INDEXES (notes collection)
 *
 * The default { _id: 1 } index already supports:
 *   - GET/PATCH/DELETE /notes/:id  -> findOne({ _id, owner }) (the _id equality
 *     match narrows to one document; owner is then checked on that document)
 *   - Admin "everyone's notes" list -> find({}).sort({ _id: -1 })
 *
 * One extra index is required:
 */

// User's own notes list: find({ owner }).sort({ _id: -1 }).skip().limit()
// plus countDocuments({ owner }). Equality on owner, then sort on _id, so the
// list is read in order straight from the index with no in-memory sort.
// Its { owner } prefix also serves deleteMany({ owner }) when an admin
// removes a user.
noteSchema.index({ owner: 1, _id: -1 });

noteSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Note', noteSchema);
