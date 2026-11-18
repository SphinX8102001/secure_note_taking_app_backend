const mongoose = require('mongoose');

const ROLES = ['user', 'admin'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    // Never returned by default; must be explicitly selected with '+password'.
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'user' },
    interests: {
      type: [{ type: String, trim: true, lowercase: true, maxlength: 50 }],
      default: [],
    },
  },
  { timestamps: true }
);

/*
 * INDEXES (users collection)
 *
 * The default { _id: 1 } index already supports:
 *   - GET a user profile by id (auth middleware, admin GET/PATCH/DELETE /users/:id)
 *   - $match { _id } at the start of the "user posts" $lookup pipeline
 *   - Admin user list: find({}).sort({ _id: -1 }).skip().limit()
 *     (_id is an ObjectId whose leading bytes are the creation time, so it is a
 *      free "newest first" ordering - no extra createdAt index needed)
 *
 * Only two extra indexes are required:
 */

// 1. Login / registration lookup: findOne({ email }). Unique also enforces
//    one account per email at the database level.
userSchema.index({ email: 1 }, { unique: true });

// 2. "Group users by interests" aggregation. Multikey index used by the
//    pipeline's leading $match (either { interests: <value> } when filtering
//    by one interest, or { interests: { $gt: '' } } to skip users with no
//    interests via an index scan instead of a collection scan).
userSchema.index({ interests: 1 });

userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
