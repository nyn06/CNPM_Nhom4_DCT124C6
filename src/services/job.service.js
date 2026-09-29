const { v4: uuidv4 } = require('uuid');
const jobRepository = require('../repositories/job.repository');

const SUPPORTED_LANGUAGES = ['vi', 'en', 'ja', 'ko', 'fr', 'zh'];

// ---- Mock các bước xử lý AI (thay bằng API thật khi làm đồ án) ----
function mockSpeechToText(fileName) {
  return `[Văn bản trích xuất giả lập từ file "${fileName}"]`;
}

function mockTranslate(text, targetLang) {
  return `[Bản dịch sang "${targetLang}"]: ${text}`;
}

function mockTextToSpeech(text) {
  return `output_${uuidv4()}.mp3`;
}
// ---------------------------------------------------------------

class JobService {
  createJob({ fileName, targetLang }) {
    if (!fileName) {
      const err = new Error('fileName là bắt buộc');
      err.statusCode = 400;
      throw err;
    }
    if (!targetLang || !SUPPORTED_LANGUAGES.includes(targetLang)) {
      const err = new Error(
        `targetLang không hợp lệ. Hỗ trợ: ${SUPPORTED_LANGUAGES.join(', ')}`
      );
      err.statusCode = 400;
      throw err;
    }

    const job = {
      id: uuidv4(),
      fileName,
      targetLang,
      status: 'processing',
      resultText: null,
      resultAudioFile: null,
      createdAt: new Date().toISOString(),
    };

    jobRepository.create(job);

    // Xử lý bất đồng bộ để không block request (giả lập job chạy nền)
    this._processJob(job.id);

    return job;
  }

  _processJob(jobId) {
  const timer = setTimeout(() => {
    const job = jobRepository.findById(jobId);

    if (!job) {
      return;
    }

    try {
      const transcript = mockSpeechToText(job.fileName);
      const translated = mockTranslate(
        transcript,
        job.targetLang
      );

      const audioFile = mockTextToSpeech(translated);

      jobRepository.update(jobId, {
        status: 'done',
        resultText: translated,
        resultAudioFile: audioFile,
      });
    } catch (error) {
      jobRepository.update(jobId, {
        status: 'failed',
      });
    }
  }, 1500);

  timer.unref();
}

  getJob(id) {
    const job = jobRepository.findById(id);
    if (!job) {
      const err = new Error('Không tìm thấy job');
      err.statusCode = 404;
      throw err;
    }
    return job;
  }

  listJobs() {
    return jobRepository.findAll();
  }

  getSupportedLanguages() {
    return SUPPORTED_LANGUAGES;
  }
}

module.exports = new JobService();
