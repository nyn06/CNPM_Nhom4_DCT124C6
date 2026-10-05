const { v4: uuidv4 } = require('uuid');
const poiRepository = require('../repositories/poi.repository');
const { calculateDistanceInMeters } = require('../utils/geo');

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
