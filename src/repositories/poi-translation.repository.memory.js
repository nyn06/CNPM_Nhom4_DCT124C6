const rows = new Map();
const key = (id, language) => `${id}:${language}`;
module.exports = {
  async findByPoiIds(ids) { return [...rows.values()].filter((row) => ids.includes(row.poiId)); },
  async save(item) { rows.set(key(item.poiId, item.language), { ...item }); return item; },
  async saveDescription(item, previous) {
    const row = rows.get(key(item.poiId, item.language));
    if (!previous && !row) {
      rows.set(key(item.poiId, item.language), { poiId: item.poiId, language: item.language,
        name: null, address: null, nameSourceHash: null, addressSourceHash: null,
        nameManual: false, addressManual: false, descriptionManual: false,
        description: item.description, descriptionSourceHash: item.descriptionSourceHash });
      return item;
    }
    if (!row || !previous || row.description !== previous.description
      || row.descriptionSourceHash !== previous.descriptionSourceHash || row.descriptionManual)
      throw Object.assign(new Error('Description changed during translation.'),
        { statusCode: 409, code: 'TRANSLATION_CONFLICT' });
    rows.set(key(item.poiId, item.language), { ...row,
      description: item.description, descriptionSourceHash: item.descriptionSourceHash });
    return item;
  },
  clear() { rows.clear(); },
};
