const mongoose = require('mongoose');
const config = require('./config');
const User = require('./models/User');
const Note = require('./models/Note');
const Post = require('./models/Post');

async function connect() {
  // autoIndex is turned off; syncIndexes() below makes the DB indexes match
  // the schema.index() definitions exactly (it also drops stale indexes that
  // are no longer declared, so no unnecessary index lingers in the database).
  await mongoose.connect(config.mongoUri, { autoIndex: false });
  await Promise.all([User.syncIndexes(), Note.syncIndexes(), Post.syncIndexes()]);
}

module.exports = { connect, mongoose };
