const express = require('express');
const User = require('../models/User');
const { interestGroupsPipeline } = require('../services/aggregations');
const { asyncHandler, getPagination, requireString } = require('../utils/http');

const router = express.Router();

// GET /api/interests/groups?interest=&page=&limit=
// Scenario 1: users grouped by interest using exactly one collection.aggregate() call.
router.get(
  '/groups',
  asyncHandler(async (req, res) => {
    const p = getPagination(req.query);
    const interest = req.query.interest
      ? requireString(req.query.interest, 'interest', { max: 50 }).toLowerCase()
      : null;

    const [result] = await User.collection
      .aggregate(interestGroupsPipeline({ interest, skip: p.skip, limit: p.limit }))
      .toArray();

    const total = result ? result.total : 0;
    res.json({
      data: result ? result.data : [],
      pagination: { page: p.page, limit: p.limit, total, totalPages: Math.ceil(total / p.limit) },
    });
  })
);

module.exports = router;
