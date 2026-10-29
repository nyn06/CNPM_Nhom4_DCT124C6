const service = require('../services/dashboard.service');

async function get(req, res, next) {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await service.getDashboard());
  } catch (error) { next(error); }
}

module.exports = { get };
