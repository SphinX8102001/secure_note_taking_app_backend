/*
 * Aggregation pipelines for the two required scenarios.
 * Kept as pure pipeline builders so the explain script can reuse them.
 */

/**
 * Scenario 1 - users grouped by interest.
 * Runs on the users collection with exactly ONE collection.aggregate() call;
 * the group list and its total count both come out of the same pipeline via $facet.
 *
 * Index: { interests: 1 } (multikey).
 *  - With ?interest=x the leading $match { interests: 'x' } is a point lookup
 *    on the index.
 *  - Without a filter the leading $match { interests: { $gt: '' } } is an
 *    index range scan that only touches users having at least one interest
 *    (users without interests would be dropped by $unwind anyway, so the
 *    result is identical but no collection scan is needed).
 */
function interestGroupsPipeline({ interest, skip, limit }) {
  const pipeline = [
    { $match: { interests: interest ? interest : { $gt: '' } } },
    { $project: { name: 1, interests: 1 } },
    { $unwind: '$interests' },
  ];
  if (interest) pipeline.push({ $match: { interests: interest } });
  pipeline.push(
    {
      $group: {
        _id: '$interests',
        userCount: { $sum: 1 },
        users: { $push: { _id: '$_id', name: '$name' } },
      },
    },
    { $sort: { userCount: -1, _id: 1 } },
    {
      $facet: {
        data: [
          { $skip: skip },
          { $limit: limit },
          { $project: { _id: 0, interest: '$_id', userCount: 1, users: 1 } },
        ],
        total: [{ $count: 'count' }],
      },
    },
    { $project: { data: 1, total: { $ifNull: [{ $first: '$total.count' }, 0] } } }
  );
  return pipeline;
}

/**
 * Scenario 2 - all posts of one user, single pipeline with $lookup.
 * Runs on the users collection:
 *  - $match { _id }                 -> default _id index on users
 *  - $lookup posts on author == _id -> { author: 1, _id: -1 } index on posts,
 *    which also yields the { _id: -1 } sort order and lets $skip/$limit stop
 *    early, so only one page of posts is ever read.
 * One extra post is fetched (limit + 1) to know whether a next page exists
 * without scanning all of the user's posts for a count.
 */
function userPostsPipeline({ userId, skip, limit }) {
  return [
    { $match: { _id: userId } },
    { $project: { name: 1, interests: 1 } },
    {
      $lookup: {
        from: 'posts',
        localField: '_id',
        foreignField: 'author',
        pipeline: [
          { $sort: { _id: -1 } },
          { $skip: skip },
          { $limit: limit + 1 },
          { $project: { title: 1, body: 1, createdAt: 1, updatedAt: 1 } },
        ],
        as: 'posts',
      },
    },
  ];
}

module.exports = { interestGroupsPipeline, userPostsPipeline };
