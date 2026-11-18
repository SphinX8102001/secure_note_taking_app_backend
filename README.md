# Secure Notes – Backend API

A REST API for taking notes. Built with Express, MongoDB/Mongoose, JWT authentication, bcrypt password hashing and role-based access control (`user` / `admin`).

The minimal frontend lives in a separate repository and calls this API over CORS.

## Project structure

```
├── src/
│   ├── models/        Mongoose schemas + every schema.index() definition
│   ├── routes/        auth, me, notes, posts, interests, admin
│   ├── services/      aggregation pipelines (Scenario 1 & 2)
│   ├── middleware/    JWT authentication + role checks
│   ├── utils/         pagination, validation, errors
│   ├── app.js         Express app (CORS, rate limiting, routes)
│   └── server.js      entry point
├── scripts/           seed, explain (index usage), smoke-test
└── render.yaml        Render deployment blueprint
```

## Run it locally

Requirements: Node 18+ and MongoDB 5.0+ running locally (or set `MONGODB_URI`).

```bash
cp .env.example .env          # then set JWT_SECRET to a long random string
npm install
npm run seed                  # demo users / notes / posts (wipes these 3 collections)
npm start                     # API on http://localhost:4000
```

Then serve the frontend repository on any localhost port (for example `npx serve -l 5173`). With `CORS_ORIGIN` empty, the API accepts any `http://localhost:<port>` origin.

## Configuration

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string (local or Atlas) |
| `JWT_SECRET` | secret used to sign tokens; a long random string |
| `JWT_EXPIRES_IN` | token lifetime, default `1d` |
| `CORS_ORIGIN` | frontend origin(s) allowed to call the API, comma separated. Empty means localhost only |
| `TRUST_PROXY` | `1` behind Render's proxy, so rate limiting sees real client IPs |
| `AUTH_RATE_LIMIT` | login/register requests allowed per IP per 15 minutes, default 20 |
| `SEED_*` | demo accounts created by `npm run seed` |

`GET /api/health` reports whether the API and its database connection are up.

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run explain` | Lists the indexes in the DB and runs `explain()` on **every** query and aggregation the API uses, showing which index each one hits |
| `npm test` | End-to-end API test (42 checks) against the running server. Set `API_URL` to test a deployed backend |

Seeded logins: `admin@example.com` (admin) and `alice|bob|carol|dave|eve|frank@example.com` (users). Passwords are `SEED_ADMIN_PASSWORD` / `SEED_USER_PASSWORD` in `.env`. The seed script refuses to put the example passwords on a non-local database.

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
- `/api/auth/*` is rate limited per IP, and CORS only accepts the configured frontend origin(s).
- Not included, but worth considering for a real product: keeping the token in an httpOnly cookie rather than the browser's `sessionStorage`.

## Deployment (Render + MongoDB Atlas)

1. **Database:** create a free MongoDB Atlas cluster and a database user. Under Network Access, allow `0.0.0.0/0`, since Render's free tier has no fixed IP. Copy the connection string and add a database name to it, e.g. `.../secure_notes?retryWrites=true&w=majority`.
2. **API:** on Render, choose *New > Blueprint* and pick this repository; `render.yaml` sets everything up. Enter `MONGODB_URI` (from step 1) and `CORS_ORIGIN` (the frontend's URL, e.g. `https://your-app.vercel.app`, no trailing slash). `JWT_SECRET` is generated automatically.
3. **Demo data:** from your machine, seed Atlas with passwords that are not the public example ones:
   ```powershell
   $env:MONGODB_URI="<atlas connection string>"; $env:SEED_ADMIN_PASSWORD="<new admin password>"; $env:SEED_USER_PASSWORD="<new user password>"; npm run seed
   ```
4. Open `https://<your-service>.onrender.com/api/health` and check it reports `"db": "up"`.

The free Render tier sleeps after 15 minutes without traffic, so the first request after that takes about a minute.
