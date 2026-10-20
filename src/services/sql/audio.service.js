const audioRepository = require('../../repositories/audio.repository');
const poiRepository = require('../../repositories/poi.repository');

class AudioService {
  async resolveAudio(filename, admin = false) {
    if (typeof filename !== 'string' || !/^[a-zA-Z0-9_-]+\.wav$/.test(filename)) {
      throw Object.assign(new Error('Đường dẫn audio không hợp lệ.'), { statusCode: 400 });
    }
    // A tourist ticket covers active POIs only, not orphan/stale/legacy WAVs.
    if (!admin && !(await poiRepository.findAll()).some((poi) => poi.isActive === true
      && Object.values(poi.narrations || {}).some((narration) => narration.audioFile === filename))) {
      throw Object.assign(new Error('Không tìm thấy audio cho POI đang hoạt động.'), { statusCode: 404 });
    }
    const file = await audioRepository.resolveFile(filename);
    if (!file) throw Object.assign(new Error('Không tìm thấy audio.'), { statusCode: 404 });
    return file;
  }
}

module.exports = new AudioService();
