const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 20000 },
  },
  { timestamps: true }
);

/*
 * INDEXES (posts collection)
 *
 * The default { _id: 1 } index already supports:
 *   - Public feed: find({}).sort({ _id: -1 })
 *   - DELETE /posts/:id
 *
 * One extra index is required:
 */

// "Posts of a particular user" ($lookup from users into posts):
// the $lookup joins on author == user._id and its sub-pipeline sorts by
// { _id: -1 } and paginates, so { author, _id } serves the join, the sort and
// the limit from the index. Its { author } prefix also serves
// deleteMany({ author }) when an admin removes a user.
postSchema.index({ author: 1, _id: -1 });

postSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Post', postSchema);
