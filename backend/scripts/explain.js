// Prints the indexes that exist and, for every query the API runs, which index
// the MongoDB planner chose (via explain('executionStats')).
// Run after `npm run seed`.
const { connect, mongoose } = require('../src/db');
const User = require('../src/models/User');
const Note = require('../src/models/Note');
const Post = require('../src/models/Post');
const { interestGroupsPipeline, userPostsPipeline } = require('../src/services/aggregations');

// Walks an explain document and collects plan stages, index names and counters.
function summarize(explain) {
  const stages = new Set();
  const indexes = new Set();
  let docsExamined = 0;
  let keysExamined = 0;
  let collScans = 0;
  (function walk(node, key) {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, key));
    if (!node || typeof node !== 'object') return;
    // rejectedPlans are alternatives the planner did NOT use
    if (key === 'rejectedPlans') return;
    if (typeof node.stage === 'string') stages.add(node.stage);
    if (typeof node.indexName === 'string') indexes.add(node.indexName);
    if (Array.isArray(node.indexesUsed)) node.indexesUsed.forEach((i) => indexes.add(`${i} ($lookup)`));
    if (typeof node.collectionScans === 'number') collScans += node.collectionScans;
    if (typeof node.totalDocsExamined === 'number') docsExamined += node.totalDocsExamined;
    if (typeof node.totalKeysExamined === 'number') keysExamined += node.totalKeysExamined;
    for (const [k, v] of Object.entries(node)) walk(v, k);
  })(explain);
  if (stages.has('COLLSCAN')) collScans += 1;
  return { stages: [...stages], indexes: [...indexes], keysExamined, docsExamined, collScans };
}

function report(label, explain) {
  const s = summarize(explain);
  const ok = s.collScans === 0 && !s.stages.includes('SORT');
  console.log(`\n${ok ? 'OK ' : '!! '} ${label}`);
  console.log(`    indexes used : ${s.indexes.join(', ') || '(none)'}`);
  console.log(`    plan stages  : ${s.stages.join(' > ')}`);
  console.log(`    keys/docs examined: ${s.keysExamined}/${s.docsExamined}, collection scans: ${s.collScans}`);
}

async function main() {
  await connect();
  const users = User.collection;
  const notes = Note.collection;
  const posts = Post.collection;

  console.log('=== Indexes defined in the database ===');
  for (const c of [users, notes, posts]) {
    const idx = await c.indexes();
    console.log(`${c.collectionName}: ${idx.map((i) => `${i.name}${i.unique ? ' (unique)' : ''}`).join(', ')}`);
  }

  const alice = await users.findOne({ email: 'alice@example.com' });
  if (!alice) throw new Error('Run `npm run seed` first.');
  const note = await notes.findOne({ owner: alice._id });
  const post = await posts.findOne({ author: alice._id });
  const page = { skip: 5, limit: 5 };

  console.log('\n=== Query plans ===');

  report('Login: users.findOne({ email })',
    await users.find({ email: 'alice@example.com' }).limit(1).explain('executionStats'));

  report('Auth / GET user by id: users.findOne({ _id })',
    await users.find({ _id: alice._id }).limit(1).explain('executionStats'));

  report('Admin list users (page 2): users.find({}).sort({ _id: -1 })',
    await users.find({}).sort({ _id: -1 }).skip(page.skip).limit(page.limit).explain('executionStats'));

  report('List own notes (page 2): notes.find({ owner }).sort({ _id: -1 })',
    await notes.find({ owner: alice._id }).sort({ _id: -1 }).skip(page.skip).limit(page.limit).explain('executionStats'));

  report('Count own notes: notes.countDocuments({ owner })',
    await mongoose.connection.db.command({
      explain: { count: 'notes', query: { owner: alice._id } }, verbosity: 'executionStats',
    }));

  report('GET note by id (owner check): notes.findOne({ _id, owner })',
    await notes.find({ _id: note._id, owner: alice._id }).limit(1).explain('executionStats'));

  report('Admin list all notes: notes.find({}).sort({ _id: -1 })',
    await notes.find({}).sort({ _id: -1 }).skip(page.skip).limit(page.limit).explain('executionStats'));

  report('Posts feed: posts.find({}).sort({ _id: -1 })',
    await posts.find({}).sort({ _id: -1 }).skip(0).limit(5).explain('executionStats'));

  report('Delete post by id: posts.deleteOne({ _id, author })',
    await posts.find({ _id: post._id, author: alice._id }).limit(1).explain('executionStats'));

  report('Admin delete user cascade: notes.deleteMany({ owner })',
    await notes.find({ owner: alice._id }).explain('executionStats'));

  report('Admin delete user cascade: posts.deleteMany({ author })',
    await posts.find({ author: alice._id }).explain('executionStats'));

  console.log('\n=== Aggregations ===');

  report('Scenario 1: users grouped by interests (all)',
    await users.aggregate(interestGroupsPipeline({ interest: null, skip: 0, limit: 10 })).explain('executionStats'));

  report("Scenario 1: users grouped by interests (interest = 'chess')",
    await users.aggregate(interestGroupsPipeline({ interest: 'chess', skip: 0, limit: 10 })).explain('executionStats'));

  report("Scenario 2: user's posts via $lookup (page 2)",
    await users.aggregate(userPostsPipeline({ userId: alice._id, skip: page.skip, limit: page.limit })).explain('executionStats'));

  console.log('\nNote: the in-memory $group/$sort in Scenario 1 is inherent (grouping needs every');
  console.log('matching user); the index only decides WHICH users are read, which is what it supports.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
