const narrations = new Map();

class NarrationRepository {
  create(narration) {
    narrations.set(narration.id, narration);
    return narration;
  }

  findById(id) {
    return narrations.get(id) || null;
  }

  findAll() {
    return Array.from(narrations.values());
  }

  update(id, data) {
    const existing = narrations.get(id);

    if (!existing) {
      return null;
    }

    const updated = {
      ...existing,
      ...data,
    };

    narrations.set(id, updated);

    return updated;
  }

  clear() {
    narrations.clear();
  }
}

module.exports = new NarrationRepository();