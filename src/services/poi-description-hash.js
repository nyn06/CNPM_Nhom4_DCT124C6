const { createHash } = require('crypto');

const hash = (value) => createHash('sha256').update(value || '', 'utf8').digest('hex');
const verifiedHash = (value) => hash(`verified:v2:${value || ''}`);
const unverifiedHash = (value) => hash(`unverified:${value || ''}`);
const displayableUnverifiedHash = (value) => hash(`displayable:unverified:v1:${value || ''}`);

module.exports = { hash, verifiedHash, unverifiedHash, displayableUnverifiedHash };
