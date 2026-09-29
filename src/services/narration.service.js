const { v4: uuidv4 } = require('uuid');
const narrationRepository = require('../repositories/narration.repository');
const piperTtsProvider = require('../integrations/tts/piperTts.provider');

const SUPPORTED_LANGUAGES = ['vi', 'en'];

class NarrationService {
  async createNarration({ text, language }) {
    if (!text || !text.trim()) {
      const error = new Error('text là bắt buộc');
      error.statusCode = 400;
      throw error;
    }

    if (!language || !SUPPORTED_LANGUAGES.includes(language)) {
      const error = new Error(
        `language không hợp lệ. Hỗ trợ: ${SUPPORTED_LANGUAGES.join(', ')}`
      );
      error.statusCode = 400;
      throw error;
    }

    const narration = {
      id: uuidv4(),
      text: text.trim(),
      language,
      status: 'processing',
      audioFile: null,
      createdAt: new Date().toISOString(),
    };

    narrationRepository.create(narration);

    try {
      const audioFile = await piperTtsProvider.synthesize(
        narration.text,
        narration.language
      );

      return narrationRepository.update(narration.id, {
        status: 'done',
        audioFile,
      });
    } catch (error) {
      narrationRepository.update(narration.id, {
        status: 'failed',
      });

      throw error;
    }
  }

  getNarrations() {
    return narrationRepository.findAll();
  }

  getNarration(id) {
    const narration = narrationRepository.findById(id);

    if (!narration) {
      const error = new Error('Không tìm thấy narration');
      error.statusCode = 404;
      throw error;
    }

    return narration;
  }

  getSupportedLanguages() {
    return SUPPORTED_LANGUAGES;
  }
}

module.exports = new NarrationService();