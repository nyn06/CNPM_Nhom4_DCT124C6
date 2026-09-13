/**
 * CONTROLLER LAYER (Presentation Layer)
 * -------------------------------------
 * Chỉ chịu trách nhiệm: nhận request HTTP, gọi Service tương ứng,
 * trả response. KHÔNG chứa logic nghiệp vụ, KHÔNG thao tác dữ liệu trực tiếp.
 */

const jobService = require('../services/job.service');

class JobController {
  createJob(req, res, next) {
    try {
      const { fileName, targetLang } = req.body;
      const job = jobService.createJob({ fileName, targetLang });
      res.status(201).json(job);
    } catch (err) {
      next(err);
    }
  }

  getJob(req, res, next) {
    try {
      const job = jobService.getJob(req.params.id);
      res.status(200).json(job);
    } catch (err) {
      next(err);
    }
  }

  listJobs(req, res, next) {
    try {
      const jobs = jobService.listJobs();
      res.status(200).json(jobs);
    } catch (err) {
      next(err);
    }
  }

  getLanguages(req, res, next) {
    try {
      res.status(200).json({ languages: jobService.getSupportedLanguages() });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new JobController();
