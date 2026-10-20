const pois = new Map();

class PoiRepository {
  create(poi) {
    pois.set(poi.id, poi);
    return poi;
  }

  findById(id) {
    return pois.get(id) || null;
  }

  findAll() {
    return Array.from(pois.values());
  }

  update(id, data) {
    const existing = pois.get(id);

    if (!existing) {
      return null;
    }

    const updated = {
      ...existing,
      ...data,
    };

    pois.set(id, updated);

    return updated;
  }

  delete(id) {
    return pois.delete(id);
  }

  clear() {
    pois.clear();
  }
}

module.exports = new PoiRepository();
