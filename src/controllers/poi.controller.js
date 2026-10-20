const poiService = require('../services/poi.service');
const publicPoi = (poi) => {
  if (!poi) return poi;
  const result = { ...poi };
  delete result.narrations;
  return result;
};

class PoiController {
  async createPoi(req, res, next) {
    try {
      const poi = await poiService.createPoi(req.body);

      res.status(201).json(poi);
    } catch (error) {
      next(error);
    }
  }

  async getPois(req, res, next) {
    try {
      const pois = await poiService.getPois();

      res.status(200).json(pois.map(publicPoi));
    } catch (error) {
      next(error);
    }
  }

  async getNearbyPois(req, res, next) {
    try {
      const { lat, lng } = req.query;
      const result = await poiService.getNearbyPois({ lat, lng });

      res.status(200).json({ ...result, pois: result.pois.map(publicPoi), nearestPoi: publicPoi(result.nearestPoi) });
    } catch (error) {
      next(error);
    }
  }

  async setVietnameseNarration(req, res, next) {
    try {
      res.status(200).json(await poiService.setVietnameseNarration(req.params.id, req.body));
    } catch (error) {
      next(error);
    }
  }

  async getPoiNarration(req, res, next) {
    try {
      await poiService.checkNarrationAccess(req.params.id, !!req.admin);
      res.status(200).json(await poiService.getPoiNarration(req.params.id, req.params.language));
    } catch (error) {
      next(error);
    }
  }

  async getPoiNarrations(req, res, next) {
    try {
      await poiService.checkNarrationAccess(req.params.id, !!req.admin);
      res.status(200).json(await poiService.getPoiNarrations(req.params.id));
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

  async getPoi(req, res, next) {
    try {
      const poi = await poiService.getPoi(req.params.id);

      res.status(200).json(publicPoi(poi));
    } catch (error) {
      next(error);
    }
  }

  async getAdminPois(req, res, next) {
    try { res.json(await poiService.getPois()); } catch (error) { next(error); }
  }

  async getAdminPoi(req, res, next) {
    try { res.json(await poiService.getPoi(req.params.id)); } catch (error) { next(error); }
  }

  async updatePoi(req, res, next) {
    try {
      const poi = await poiService.updatePoi(req.params.id, req.body);

      res.status(200).json(poi);
    } catch (error) {
      next(error);
    }
  }

  async deletePoi(req, res, next) {
    try {
      await poiService.deletePoi(req.params.id);

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new PoiController();
