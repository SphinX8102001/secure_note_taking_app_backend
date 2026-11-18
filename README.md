# Secure Notes

A REST API for taking notes, with a minimal frontend. Built with Express, MongoDB/Mongoose, JWT authentication, bcrypt password hashing and role-based access control (`user` / `admin`).

## Project structure

```
secure_note_taking_app/
├── backend/                  REST API (the focus of this task)
│   ├── src/
│   │   ├── models/           Mongoose schemas + every schema.index() definition
│   │   ├── routes/           auth, me, notes, posts, interests, admin
│   │   ├── services/         aggregation pipelines (Scenario 1 & 2)
│   │   ├── middleware/       JWT authentication + role checks
│   │   ├── utils/            pagination, validation, errors
│   │   ├── app.js            Express app
│   │   └── server.js         entry point
│   └── scripts/              seed, explain (index usage), smoke-test
└── frontend/                 minimal vanilla-JS client (index.html, app.js)
```

The backend serves `frontend/` as static files, so the whole app runs on a single port and needs no CORS setup.

## Run it

Requirements: Node 18+ and MongoDB 5.0+ running locally (or set `MONGODB_URI`). Run all commands from `backend/`.

```bash
cd backend
cp .env.example .env          # then set JWT_SECRET to a long random string
npm install
npm run seed                  # demo users / notes / posts (wipes these 3 collections)
npm start                     # http://localhost:4000
```

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run explain` | Lists the indexes in the DB and runs `explain()` on **every** query and aggregation the API uses, showing which index each one hits |
| `npm test` | End-to-end API test (42 checks) against the running server |

Seeded logins: `admin@example.com` (admin) and `alice|bob|carol|dave|eve|frank@example.com` (users). Passwords are `SEED_ADMIN_PASSWORD` / `SEED_USER_PASSWORD` in `.env`.

## API

Send the token from login or register as `Authorization: Bearer <token>`. Every list endpoint accepts `?page=` and `?limit=` (default 10, max 100).

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | public | always creates role `user` |
| POST | `/api/auth/login` | public | |
| GET / PATCH | `/api/me` | user | users may change their own name and interests only |
| GET | `/api/notes` | user | the caller's own notes, paginated |
| POST | `/api/notes` | user | |
| GET | `/api/notes/:id` | owner, admin | |
| PATCH / DELETE | `/api/notes/:id` | owner | |
| GET | `/api/posts` | user | public feed |
| POST | `/api/posts` | user | |
| DELETE | `/api/posts/:id` | author, admin | |
| GET | `/api/posts/user/:userId` | user | **Scenario 2**: single pipeline with `$lookup` |
| GET | `/api/interests/groups?interest=` | user | **Scenario 1**: one `collection.aggregate()` call |
| GET / POST | `/api/admin/users` | admin | list / create users of any role |
| GET / PATCH / DELETE | `/api/admin/users/:id` | admin | deleting a user also deletes their notes and posts |
| GET | `/api/admin/notes` | admin | everyone's notes |

## Indexing strategy

Every index is declared with `schema.index()` in `backend/src/models/*`. On startup `syncIndexes()` makes the database match those declarations exactly, and drops any index that isn't declared.

**Only 4 indexes are added on top of the default `_id` indexes:**

| Collection | Index | Required by |
| --- | --- | --- |
| users | `{ email: 1 }` unique | login lookup; also enforces one account per email |
| users | `{ interests: 1 }` (multikey) | Scenario 1: the pipeline's leading `$match` |
| notes | `{ owner: 1, _id: -1 }` | "my notes" list: equality on `owner` plus sort and paginate on `_id`, read in order with no in-memory sort; also covers `countDocuments({owner})` with a `COUNT_SCAN` |
| posts | `{ author: 1, _id: -1 }` | Scenario 2: the `$lookup` join on `author`, with its sort and limit |

Why no other indexes are needed:

- **Lists are sorted by `_id` rather than `createdAt`.** An ObjectId starts with a timestamp, so sorting by `_id: -1` means "newest first". The admin user list, the admin notes list and the posts feed can then use the built-in `_id` index instead of a `createdAt` index each.
- **Single-document reads and writes** (`GET/PATCH/DELETE /notes/:id`, `/admin/users/:id`, `DELETE /posts/:id`, and the auth middleware's user lookup) match on `_id`, which already narrows the result to one document.
- **Cascade deletes** (`deleteMany({owner})` and `deleteMany({author})`) use the prefixes of the compound indexes above.
- **Totals for unfiltered lists** come from `estimatedDocumentCount()`, which reads collection metadata and doesn't scan anything.
- **No `createdAt`, `role` or `name` indexes**, because no query filters or sorts on those fields.

### Scenario 1: users grouped by interests (`backend/src/services/aggregations.js`)

```
$match { interests: <value> | { $gt: '' } }   <- IXSCAN on interests_1
$project → $unwind → [$match interest] → $group → $sort
$facet { data: [$skip, $limit], total: [$count] }
```

This is a single `User.collection.aggregate()` call: `$facet` returns both the page of groups and the total number of groups.

- **Without a filter,** `{ $gt: '' }` is an index range scan over users who have at least one interest. Users with no interests would be dropped by `$unwind` anyway, so the results are the same, but no collection scan is needed.
- **With `?interest=chess`,** it becomes an index point lookup.

### Scenario 2: posts of one user (`$lookup`)

```
users: $match { _id }                     <- _id_ index
$lookup posts on author = _id, pipeline [$sort {_id:-1}, $skip, $limit: limit+1]
                                          <- author_1__id_-1 (join + sort + early stop)
```

The pipeline fetches `limit + 1` posts so it can tell whether there's a next page (`hasMore`) without counting all of the user's posts.

`npm run explain` confirms these plans: every query uses an index (`IXSCAN`, `EXPRESS_IXSCAN` or `COUNT_SCAN`), with no collection scans and no in-memory sorts. The only in-memory stages left are Scenario 1's `$group` and the `$sort` that follows it, which have to see every matching user by nature.

## Security notes

- Passwords are hashed with bcrypt (cost 12). The `password` field is `select: false` and is stripped in `toJSON`, so it's never returned by the API.
- JWTs are signed with HS256, and verification pins that algorithm. On every request the middleware reloads the user, so deleting a user or changing their role takes effect immediately.
- Login runs a bcrypt comparison even when the email doesn't exist, so response timing doesn't reveal which accounts exist.
- Privilege boundaries: public registration can't set a role; `PATCH /api/me` can't change role or email; users can't touch other users' notes; an admin can't demote or delete themselves.
- The frontend renders all user content with `textContent`, never `innerHTML`.
- Not included, but recommended for production: rate limiting on `/api/auth/*`, HTTPS, and keeping the token in an httpOnly cookie rather than `sessionStorage`.
