const rows = new Map();
const key = (id, language) => `${id}:${language}`;
module.exports = {
  async findByPoiIds(ids) { return [...rows.values()].filter((row) => ids.includes(row.poiId)); },
  async save(item) { rows.set(key(item.poiId, item.language), { ...item }); return item; },
  clear() { rows.clear(); },
};
