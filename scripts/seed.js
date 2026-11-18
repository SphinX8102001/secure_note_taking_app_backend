// Resets the users/notes/posts collections and inserts demo data.
// Works against local MongoDB or a hosted one (Atlas) via MONGODB_URI.
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const { connect, mongoose } = require('../src/db');
const User = require('../src/models/User');
const Note = require('../src/models/Note');
const Post = require('../src/models/Post');

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin123!';
const USER_PASSWORD = process.env.SEED_USER_PASSWORD || 'User123!';

// The example passwords are public (they are in .env.example on GitHub), so
// refuse to put them on any database that isn't on this machine.
const PUBLIC_PASSWORDS = ['Admin123!', 'User123!'];
const isLocalDb = /^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(config.mongoUri);
if (!isLocalDb && (PUBLIC_PASSWORDS.includes(ADMIN_PASSWORD) || PUBLIC_PASSWORDS.includes(USER_PASSWORD))) {
  console.error('Refusing to seed a remote database with the public example passwords.');
  console.error('Set SEED_ADMIN_PASSWORD and SEED_USER_PASSWORD to new values first.');
  process.exit(1);
}

const PEOPLE = [
  { name: 'Alice', interests: ['chess', 'reading'] },
  { name: 'Bob', interests: ['chess', 'hiking'] },
  { name: 'Carol', interests: ['reading', 'cooking', 'hiking'] },
  { name: 'Dave', interests: ['gaming'] },
  { name: 'Eve', interests: ['chess', 'cooking'] },
  { name: 'Frank', interests: [] },
];

async function main() {
  await connect();
  await Promise.all([User.deleteMany({}), Note.deleteMany({}), Post.deleteMany({})]);

  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const userHash = await bcrypt.hash(USER_PASSWORD, 12);

  const admin = await User.create({
    name: 'Admin', email: ADMIN_EMAIL, password: adminHash, role: 'admin', interests: ['reading'],
  });
  const users = await User.insertMany(
    PEOPLE.map((p) => ({ ...p, email: `${p.name.toLowerCase()}@example.com`, password: userHash }))
  );

  const notes = [];
  const posts = [];
  for (const u of [admin, ...users]) {
    for (let i = 1; i <= 7; i++) {
      notes.push({ owner: u._id, title: `${u.name}'s note #${i}`, content: `Private note ${i} of ${u.name}.` });
    }
    for (let i = 1; i <= 6; i++) {
      posts.push({ author: u._id, title: `${u.name}'s post #${i}`, body: `Public post ${i} by ${u.name}.` });
    }
  }
  // Sequential inserts keep _id order == creation order.
  await Note.insertMany(notes);
  await Post.insertMany(posts);

  console.log(`Seeded ${users.length + 1} users, ${notes.length} notes, ${posts.length} posts.`);
  console.log(`Admin login: ${ADMIN_EMAIL} (password from SEED_ADMIN_PASSWORD in .env)`);
  console.log(`User logins: <name>@example.com, e.g. alice@example.com (password from SEED_USER_PASSWORD)`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
