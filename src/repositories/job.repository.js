/**
 * REPOSITORY LAYER (Data Access Layer)
 * -------------------------------------
 * Chỉ chịu trách nhiệm đọc/ghi dữ liệu.
 * KHÔNG chứa logic nghiệp vụ (business logic).
 * Hiện dùng bộ nhớ (Map) để demo — khi làm thật, chỉ cần thay nội dung
 * các hàm bên dưới bằng câu lệnh SQL/ORM (Sequelize, TypeORM, Prisma...),
 * còn Service layer ở tầng trên không cần sửa gì cả.
 */

const jobs = new Map();

class JobRepository {
  create(job) {
    jobs.set(job.id, job);
    return job;
  }

  findById(id) {
    return jobs.get(id) || null;
  }

  findAll() {
    return Array.from(jobs.values());
  }

  update(id, patch) {
    const existing = jobs.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    jobs.set(id, updated);
    return updated;
  }

  delete(id) {
    return jobs.delete(id);
  }

  clear() {
    jobs.clear();
  }
}

// Export 1 instance duy nhất (singleton) để toàn bộ app dùng chung 1 "database"
module.exports = new JobRepository();
