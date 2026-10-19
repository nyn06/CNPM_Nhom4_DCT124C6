// Compatibility export only. No environment flag, hostname or request header
// can grant access. All production routes use requireAdmin + RBAC + CSRF.
module.exports = require('./requireAdmin').requireAdmin;
