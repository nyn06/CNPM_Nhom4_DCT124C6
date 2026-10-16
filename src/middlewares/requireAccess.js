const accessService = require('../services/access.service');
const demoAdmin = require('./demoAdmin');

function requireAccess(req, res, next) {
  try {
    req.accessSession = accessService.validateAuthorization(req.get('authorization'));
    res.set('Cache-Control', 'no-store');
    next();
  } catch (error) { next(error); }
}

// Existing narration endpoints also serve the local Stage 7 editor. This
// explicit header is only a routing hint; demoAdmin still verifies the boundary.
function narrationAccess(req, res, next) {
  if (req.get('x-demo-admin') === 'true') return demoAdmin(req, res, next);
  requireAccess(req, res, next);
}

module.exports = { requireAccess, narrationAccess };
