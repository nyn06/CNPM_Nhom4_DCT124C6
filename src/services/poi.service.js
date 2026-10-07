const { v4: uuidv4 } = require('uuid');
const poiRepository = require('../repositories/poi.repository');
const { calculateDistanceInMeters } = require('../utils/geo');
const translationProvider = require('../integrations/translation/translation.provider');
const piperTtsProvider = require('../integrations/tts/piperTts.provider');
const { sourceLanguage, names: narrationLanguages } = require('../../public/js/poi-languages');

class PoiService {
  createPoi(data) {
    this._validateBody(data);

    const { category = 'food', address = '', isActive = true } = data;
    const fields = this._preparePoi({ ...data, category, address, isActive });
    const now = new Date().toISOString();

    return poiRepository.create({
      id: uuidv4(),
      ...fields,
      createdAt: now,
      updatedAt: now,
    });
  }

  getPois() {
    return poiRepository.findAll();
  }

  getNearbyPois({ lat, lng }) {
    const latitude = this._parseCoordinate(lat, 'lat', -90, 90);
    const longitude = this._parseCoordinate(lng, 'lng', -180, 180);

    const pois = poiRepository.findAll()
      .filter((poi) => poi.isActive === true)
      .map((poi) => ({
        ...poi,
        distance: calculateDistanceInMeters(
          latitude, longitude, poi.latitude, poi.longitude
        ),
      }))
      // So sánh và sắp xếp trước khi làm tròn để giữ đúng ranh giới geofence.
      .filter((poi) => poi.distance <= poi.geofenceRadius)
      .sort((first, second) => first.distance - second.distance)
      .map((poi) => ({
        ...poi,
        distance: Number(poi.distance.toFixed(2)),
        insideGeofence: true,
      }));

    return {
      userLocation: { latitude, longitude },
      insideGeofence: pois.length > 0,
      nearestPoi: pois[0] || null,
      pois,
    };
  }

  getPoi(id) {
    const poi = poiRepository.findById(id);

    if (!poi) {
      const error = new Error('Không tìm thấy POI');
      error.statusCode = 404;
      throw error;
    }

    return poi;
  }

  updatePoi(id, data) {
    const existing = this.getPoi(id);
    this._validateBody(data);

    // Giữ các trường không được gửi; chỉ lưu những trường được phép sửa.
    const fields = this._preparePoi({ ...existing, ...data });

    return poiRepository.update(id, {
      ...fields,
      updatedAt: new Date().toISOString(),
    });
  }

  deletePoi(id) {
    this.getPoi(id);
    return poiRepository.delete(id);
  }

  setVietnameseNarration(id, data) {
    const poi = this.getPoi(id);
    if (!data || typeof data.text !== 'string' || !data.text.trim()) {
      const error = new Error('text là bắt buộc và phải là chuỗi không rỗng');
      error.statusCode = 400;
      throw error;
    }
    const text = data.text.trim();
    // Nguồn thay đổi thì bỏ bản dịch cũ. Gửi lại cùng text giữ các bản dịch hiện có.
    const existing = poi.narrations || {};
    const narrations = existing[sourceLanguage]?.text === text ? { ...existing } : {};
    narrations[sourceLanguage] = existing[sourceLanguage]?.text === text ? existing[sourceLanguage] : { text };
    const updatedAt = new Date().toISOString();
    poiRepository.update(id, { narrations, updatedAt });
    return { poiId: id, language: sourceLanguage, text, updatedAt };
  }

  getPoiNarration(id, language) {
    const poi = this.getPoi(id);
    if (!Object.prototype.hasOwnProperty.call(narrationLanguages, language)) {
      const error = new Error('Ngôn ngữ thuyết minh không được hỗ trợ');
      error.statusCode = 400;
      throw error;
    }
    const narration = poi.narrations?.[language];
    if (!narration) {
      const error = new Error('Chưa có nội dung thuyết minh cho ngôn ngữ này');
      error.statusCode = 404;
      throw error;
    }
    return {
      poiId: id, language, text: narration.text,
      ...(narration.audioFile ? {
        audioFile: narration.audioFile,
        audioUrl: `/audio/${narration.audioFile}`,
      } : {}),
    };
  }

  getPoiNarrations(id) {
    const poi = this.getPoi(id);
    return { poiId: id, narrations: poi.narrations || {} };
  }

  async createTranslations(id, data) {
    const poi = this.getPoi(id);
    const targets = data?.targetLanguages;
    if (!Array.isArray(targets) || targets.length === 0 || new Set(targets).size !== targets.length
      || targets.some((language) => typeof language !== 'string' || language === sourceLanguage
        || !Object.prototype.hasOwnProperty.call(narrationLanguages, language))) {
      const error = new Error('targetLanguages phải là mảng không rỗng, không trùng lặp, chỉ chứa en, ja, ko');
      error.statusCode = 400;
      throw error;
    }
    const source = poi.narrations?.[sourceLanguage];
    if (!source?.text) {
      const error = new Error('Cần lưu nội dung thuyết minh tiếng Việt trước khi dịch');
      error.statusCode = 400;
      throw error;
    }

    let entries;
    try {
      entries = await Promise.all(targets.map(async (language) => {
        const result = await translationProvider.translate(source.text, sourceLanguage, language);
        if (!result || typeof result.text !== 'string' || !result.text.trim()) {
          throw new Error('Invalid translation');
        }
        return [language, { text: result.text.trim() }];
      }));
    } catch (providerFailure) {
      // Chỉ trả thông báo do ứng dụng kiểm soát, không expose lỗi gốc có thể chứa secret.
      const messages = {
        502: 'Dịch vụ dịch gặp lỗi hoặc trả nội dung không hợp lệ. Chưa lưu bản dịch nào của yêu cầu này.',
        503: 'Dịch vụ dịch chưa được cấu hình hợp lệ hoặc bị từ chối xác thực. Kiểm tra TRANSLATION_PROVIDER, TRANSLATION_API_URL và API key.',
        504: 'Dịch vụ dịch quá thời gian chờ. Chưa lưu bản dịch nào của yêu cầu này.',
      };
      const statusCode = [503, 504].includes(providerFailure?.statusCode) ? providerFailure.statusCode : 502;
      const error = new Error(messages[statusCode]);
      error.statusCode = statusCode;
      throw error;
    }

    // Re-read sau await: không khôi phục POI đã xóa, không lưu bản dịch từ nguồn đã đổi.
    const current = this.getPoi(id);
    // Metadata audio có thể đổi trong lúc dịch, chỉ thay đổi text mới làm nguồn mất hiệu lực.
    if (current.narrations?.[sourceLanguage]?.text !== source.text) {
      const error = new Error('Nội dung tiếng Việt đã thay đổi trong khi dịch. Hãy gửi lại yêu cầu.');
      error.statusCode = 409;
      throw error;
    }
    const translations = Object.fromEntries(entries.map(([language, narration]) => {
      const previous = current.narrations?.[language];
      // Giữ audio chỉ khi bản dịch mới giống hệt text đã tạo audio.
      return [language, previous?.text === narration.text ? { ...previous } : narration];
    }));
    poiRepository.update(id, {
      narrations: { ...current.narrations, ...translations },
      updatedAt: new Date().toISOString(),
    });
    return { poiId: id, sourceLanguage, translations };
  }

  async createPoiAudio(id, language) {
    const source = this.getPoiNarration(id, language);
    if (typeof source.text !== 'string' || !source.text.trim()) {
      const error = new Error('Nội dung thuyết minh phải là chuỗi không rỗng trước khi tạo audio');
      error.statusCode = 400;
      throw error;
    }

    let audioFile;
    try {
      audioFile = await piperTtsProvider.synthesize(source.text, language);
      // Provider chỉ được trả tên WAV, không nhận path hoặc URL từ implementation bên ngoài.
      if (typeof audioFile !== 'string' || !/^[a-zA-Z0-9_-]+\.wav$/.test(audioFile)) {
        throw new Error('Invalid audio filename');
      }
    } catch {
      const error = new Error('Không tạo được audio thuyết minh. Kiểm tra cấu hình Piper và thử lại.');
      error.statusCode = 500;
      throw error;
    }

    const current = this.getPoi(id);
    const narration = current.narrations?.[language];
    if (narration?.text !== source.text) {
      const error = new Error('Nội dung thuyết minh đã thay đổi trong khi tạo audio. Hãy gửi lại yêu cầu.');
      error.statusCode = 409;
      throw error;
    }
    const updatedAt = new Date().toISOString();
    poiRepository.update(id, {
      narrations: { ...current.narrations, [language]: { ...narration, audioFile } },
      updatedAt,
    });
    return { poiId: id, language, text: narration.text, audioFile, audioUrl: `/audio/${audioFile}`, updatedAt };
  }

  _parseCoordinate(value, field, min, max) {
    // Chỉ nhận một chuỗi số thập phân hoàn chỉnh, có thể có phần số mũ.
    const decimalPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
    const coordinate = typeof value === 'string' && decimalPattern.test(value.trim())
      ? Number(value)
      : NaN;

    if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) {
      const error = new Error(
        `${field} là bắt buộc và phải là số hữu hạn trong khoảng ${min} đến ${max}`
      );
      error.statusCode = 400;
      throw error;
    }

    return coordinate;
  }

  _validateBody(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      const error = new Error('Dữ liệu POI phải là một object');
      error.statusCode = 400;
      throw error;
    }
  }

  _preparePoi(poi) {
    if (typeof poi.name !== 'string' || !poi.name.trim()) {
      const error = new Error('name là bắt buộc và phải là chuỗi không rỗng');
      error.statusCode = 400;
      throw error;
    }

    if (typeof poi.description !== 'string' || !poi.description.trim()) {
      const error = new Error('description là bắt buộc và phải là chuỗi không rỗng');
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isFinite(poi.latitude) || poi.latitude < -90 || poi.latitude > 90) {
      const error = new Error('latitude phải là số hợp lệ trong khoảng -90 đến 90');
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isFinite(poi.longitude) || poi.longitude < -180 || poi.longitude > 180) {
      const error = new Error('longitude phải là số hợp lệ trong khoảng -180 đến 180');
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isFinite(poi.geofenceRadius) || poi.geofenceRadius <= 0) {
      const error = new Error('geofenceRadius phải là số dương hợp lệ');
      error.statusCode = 400;
      throw error;
    }

    if (typeof poi.category !== 'string' || !poi.category.trim()) {
      const error = new Error('category phải là chuỗi không rỗng');
      error.statusCode = 400;
      throw error;
    }

    if (typeof poi.address !== 'string') {
      const error = new Error('address phải là chuỗi');
      error.statusCode = 400;
      throw error;
    }

    if (typeof poi.isActive !== 'boolean') {
      const error = new Error('isActive phải là boolean');
      error.statusCode = 400;
      throw error;
    }

    return {
      name: poi.name.trim(),
      description: poi.description.trim(),
      category: poi.category.trim(),
      address: poi.address.trim(),
      latitude: poi.latitude,
      longitude: poi.longitude,
      geofenceRadius: poi.geofenceRadius,
      isActive: poi.isActive,
    };
  }
}

module.exports = new PoiService();
