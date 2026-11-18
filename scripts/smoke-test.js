// End-to-end API check against a running server (npm start) with seeded data (npm run seed).
require('dotenv').config();

// Set API_URL to test a deployed backend, e.g. API_URL=https://my-api.onrender.com
const ROOT = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
const BASE = `${ROOT.replace(/\/$/, '')}/api`;
const ADMIN = { email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com', password: process.env.SEED_ADMIN_PASSWORD || 'Admin123!' };
const USER_PASSWORD = process.env.SEED_USER_PASSWORD || 'User123!';

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra ? '  -> ' + extra : ''}`);
  if (!cond) failures++;
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

async function main() {
  // --- auth
  let r = await call('POST', '/auth/login', { body: { email: 'alice@example.com', password: 'wrong-pass' } });
  check('wrong password rejected (401)', r.status === 401);
  r = await call('POST', '/auth/login', { body: { email: 'alice@example.com', password: USER_PASSWORD } });
  check('user login', r.status === 200 && r.data.token && !('password' in r.data.user));
  const alice = r.data;
  r = await call('POST', '/auth/login', { body: ADMIN });
  check('admin login', r.status === 200 && r.data.user.role === 'admin');
  const admin = r.data;

  const email = `smoke${Date.now()}@example.com`;
  r = await call('POST', '/auth/register', { body: { name: 'Smoke', email, password: 'short' } });
  check('register rejects short password (400)', r.status === 400);
  r = await call('POST', '/auth/register', { body: { name: 'Smoke', email, password: 'Smoke123!', interests: ['Chess', ' Chess ', 'tennis'], role: 'admin' } });
  check('register creates role=user even if admin requested', r.status === 201 && r.data.user.role === 'user');
  check('interests normalised + de-duplicated', JSON.stringify(r.data.user.interests) === '["chess","tennis"]');
  const smoke = r.data;
  r = await call('POST', '/auth/register', { body: { name: 'Dup', email, password: 'Smoke123!' } });
  check('duplicate email rejected (409)', r.status === 409);

  r = await call('GET', '/notes');
  check('no token -> 401', r.status === 401);
  r = await call('GET', '/notes', { token: 'garbage' });
  check('bad token -> 401', r.status === 401);

  // --- notes
  r = await call('GET', '/notes?page=2&limit=5', { token: alice.token });
  check('own notes paginated', r.status === 200 && r.data.data.length === 2 && r.data.pagination.total === 7 && r.data.pagination.totalPages === 2);
  check('only own notes returned', r.data.data.every((n) => n.owner === alice.user._id));
  const aliceNoteId = r.data.data[0]._id;

  r = await call('POST', '/notes', { token: smoke.token, body: { title: 'Mine', content: 'secret' } });
  check('create note', r.status === 201);
  const smokeNote = r.data.note;
  r = await call('PATCH', `/notes/${smokeNote._id}`, { token: smoke.token, body: { title: 'Mine v2' } });
  check('update own note', r.status === 200 && r.data.note.title === 'Mine v2');
  r = await call('GET', `/notes/${smokeNote._id}`, { token: smoke.token });
  check('get own note', r.status === 200);

  r = await call('GET', `/notes/${aliceNoteId}`, { token: smoke.token });
  check("user cannot read another user's note (404)", r.status === 404);
  r = await call('PATCH', `/notes/${aliceNoteId}`, { token: smoke.token, body: { title: 'hacked' } });
  check("user cannot update another user's note", r.status === 404);
  r = await call('DELETE', `/notes/${aliceNoteId}`, { token: smoke.token });
  check("user cannot delete another user's note", r.status === 404);
  r = await call('GET', `/notes/${aliceNoteId}`, { token: admin.token });
  check("admin can read anyone's note", r.status === 200);
  r = await call('GET', '/notes/not-an-id', { token: alice.token });
  check('invalid id -> 400', r.status === 400);

  // --- admin
  r = await call('GET', '/admin/users', { token: alice.token });
  check('user cannot access admin routes (403)', r.status === 403);
  r = await call('GET', '/admin/users?page=1&limit=3', { token: admin.token });
  check('admin lists users paginated', r.status === 200 && r.data.data.length === 3 && r.data.pagination.total >= 8);
  check('password hashes never returned', r.data.data.every((u) => !('password' in u)));
  r = await call('GET', '/admin/notes?limit=4', { token: admin.token });
  check("admin lists everyone's notes with owner", r.status === 200 && r.data.data.length === 4 && r.data.data[0].owner.name);

  r = await call('POST', '/admin/users', { token: admin.token, body: { name: 'Made', email: `made${Date.now()}@example.com`, password: 'Made1234!', role: 'admin' } });
  check('admin creates user', r.status === 201 && r.data.user.role === 'admin');
  const made = r.data.user;
  r = await call('PATCH', `/admin/users/${made._id}`, { token: admin.token, body: { role: 'user', interests: ['chess'] } });
  check('admin updates user', r.status === 200 && r.data.user.role === 'user');
  r = await call('PATCH', `/admin/users/${admin.user._id}`, { token: admin.token, body: { role: 'user' } });
  check('admin cannot demote self', r.status === 400);
  r = await call('DELETE', `/admin/users/${admin.user._id}`, { token: admin.token });
  check('admin cannot delete self', r.status === 400);

  // --- posts & aggregations
  r = await call('POST', '/posts', { token: smoke.token, body: { title: 'Hello', body: 'world' } });
  check('create post', r.status === 201);
  const smokePost = r.data.post;
  r = await call('GET', '/posts?limit=3', { token: alice.token });
  check('feed paginated + author populated', r.status === 200 && r.data.data.length === 3 && r.data.data[0].author.name);
  r = await call('GET', `/posts/user/${alice.user._id}?page=1&limit=4`, { token: smoke.token });
  check('$lookup user posts page 1', r.status === 200 && r.data.user.name === 'Alice' && r.data.data.length === 4 && r.data.pagination.hasMore === true);
  check('$lookup posts newest first', r.data.data[0]._id > r.data.data[1]._id);
  r = await call('GET', `/posts/user/${alice.user._id}?page=2&limit=4`, { token: smoke.token });
  check('$lookup user posts page 2', r.data.data.length === 2 && r.data.pagination.hasMore === false);
  r = await call('GET', '/posts/user/000000000000000000000000', { token: smoke.token });
  check('$lookup unknown user -> 404', r.status === 404);
  r = await call('DELETE', `/posts/${smokePost._id}`, { token: alice.token });
  check("user cannot delete another's post", r.status === 404);

  r = await call('GET', '/interests/groups', { token: alice.token });
  const chess = r.data.data.find((g) => g.interest === 'chess');
  check('interest groups', r.status === 200 && chess && chess.userCount >= 3);
  check('interest groups sorted by size', r.data.data[0].userCount >= r.data.data[r.data.data.length - 1].userCount);
  r = await call('GET', '/interests/groups?interest=Hiking', { token: alice.token });
  check('interest filter', r.data.data.length === 1 && r.data.data[0].interest === 'hiking' && r.data.data[0].userCount === 2);
  r = await call('GET', '/interests/groups?limit=2&page=2', { token: alice.token });
  check('interest groups paginated', r.data.data.length === 2 && r.data.pagination.total >= 5);

  r = await call('PATCH', '/me', { token: smoke.token, body: { interests: ['go'], role: 'admin' } });
  check('user updates own interests but not role', r.status === 200 && r.data.user.role === 'user' && r.data.user.interests[0] === 'go');

  // --- cascade delete + token invalidation
  r = await call('DELETE', `/admin/users/${smoke.user._id}`, { token: admin.token });
  check('admin deletes user', r.status === 204);
  r = await call('GET', `/notes/${smokeNote._id}`, { token: admin.token });
  check("deleted user's notes removed", r.status === 404);
  r = await call('GET', '/notes', { token: smoke.token });
  check("deleted user's token stops working", r.status === 401);
  await call('DELETE', `/admin/users/${made._id}`, { token: admin.token });

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
