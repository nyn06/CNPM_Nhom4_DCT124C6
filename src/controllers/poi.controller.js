const poiService = require('../services/poi.service');

class PoiController {
  createPoi(req, res, next) {
    try {
      const poi = poiService.createPoi(req.body);

      res.status(201).json(poi);
    } catch (error) {
      next(error);
    }
  }

  getPois(req, res, next) {
    try {
      const pois = poiService.getPois();

      res.status(200).json(pois);
    } catch (error) {
      next(error);
    }
  }

  getNearbyPois(req, res, next) {
    try {
      const { lat, lng } = req.query;
      const result = poiService.getNearbyPois({ lat, lng });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  setVietnameseNarration(req, res, next) {
    try {
      res.status(200).json(poiService.setVietnameseNarration(req.params.id, req.body));
    } catch (error) {
      next(error);
    }
  }

  getPoiNarration(req, res, next) {
    try {
      res.status(200).json(poiService.getPoiNarration(req.params.id, req.params.language));
    } catch (error) {
      next(error);
    }
  }

  getPoiNarrations(req, res, next) {
    try {
      res.status(200).json(poiService.getPoiNarrations(req.params.id));
    } catch (error) {
      next(error);
    }
  }

  async createTranslations(req, res, next) {
    try {
      const result = await poiService.createTranslations(req.params.id, req.body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async createPoiAudio(req, res, next) {
    try {
      const result = await poiService.createPoiAudio(req.params.id, req.params.language);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  getPoi(req, res, next) {
    try {
      const poi = poiService.getPoi(req.params.id);

      res.status(200).json(poi);
    } catch (error) {
      next(error);
    }
  }

  updatePoi(req, res, next) {
    try {
      const poi = poiService.updatePoi(req.params.id, req.body);

      res.status(200).json(poi);
    } catch (error) {
      next(error);
    }
  }

  deletePoi(req, res, next) {
    try {
      poiService.deletePoi(req.params.id);

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new PoiController();
