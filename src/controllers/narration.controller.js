const narrationService = require('../services/narration.service');

class NarrationController {
  async createNarration(req, res, next) {
    try {
      const { text, language } = req.body;

      const narration = await narrationService.createNarration({
        text,
        language,
      });

      res.status(201).json(narration);
    } catch (error) {
      next(error);
    }
  }

  getNarrations(req, res, next) {
    try {
      const narrations = narrationService.getNarrations();

      res.status(200).json(narrations);
    } catch (error) {
      next(error);
    }
  }

  getNarration(req, res, next) {
    try {
      const narration = narrationService.getNarration(req.params.id);

      res.status(200).json(narration);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new NarrationController();