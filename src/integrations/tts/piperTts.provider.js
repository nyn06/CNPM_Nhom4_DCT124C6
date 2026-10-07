const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const VOICE_CONFIG = {
  vi: {
    model: 'vi_VN-vais1000-medium.onnx',
    config: 'vi_VN-vais1000-medium.onnx.json',
  },

  en: {
    model: 'en_US-lessac-medium.onnx',
    config: 'en_US-lessac-medium.onnx.json',
  },
  ja: {
    model: 'ja_JP-hi_fi_captain-medium.onnx',
    config: 'ja_JP-hi_fi_captain-medium.onnx.json',
  },
  ko: {
    model: 'ko_KR-kss-medium.onnx',
    config: 'ko_KR-kss-medium.onnx.json',
  },
};

class PiperTtsProvider {
  async synthesize(text, language) {
    const voice = Object.prototype.hasOwnProperty.call(VOICE_CONFIG, language) ? VOICE_CONFIG[language] : null;

    if (!voice) {
      const error = new Error('Piper chưa cấu hình ngôn ngữ được yêu cầu');
      error.statusCode = 400;
      throw error;
    }

    const rootDir = path.resolve(__dirname, '../../..');

    const piperPath = path.join(
      rootDir,
      '.venv',
      'Scripts',
      'piper.exe'
    );

    const modelPath = path.join(
      rootDir,
      'models',
      voice.model
    );

    const configPath = path.join(
      rootDir,
      'models',
      voice.config
    );

    const id = uuidv4();

    const fileName = `narration_${id}.wav`;

    const audioDir = path.join(
      rootDir,
      'public',
      'audio'
    );

    const tempDir = path.join(
      rootDir,
      'temp'
    );

    const outputPath = path.join(
      audioDir,
      fileName
    );

    const inputPath = path.join(
      tempDir,
      `tts_${id}.txt`
    );

    const args = [
      '--model',
      modelPath,
      '--config',
      configPath,
      '--input-file',
      inputPath,
      '--output-file',
      outputPath,
    ];

    try {
      await fs.mkdir(audioDir, { recursive: true });
      await fs.mkdir(tempDir, { recursive: true });
      await fs.writeFile(inputPath, text, { encoding: 'utf8' });
      await new Promise((resolve, reject) => {
        execFile(
          piperPath,
          args,
          {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 120000,
          },
          (error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          }
        );
      });

      const output = await fs.stat(outputPath);
      if (!output.isFile() || output.size <= 44) throw new Error('Missing or empty WAV');
      return fileName;
    } catch {
      // Không trả stderr, command hoặc filesystem path ra API; bỏ output dở nếu có.
      await fs.unlink(outputPath).catch(() => {});
      const error = new Error('Không tạo được audio thuyết minh. Kiểm tra cấu hình Piper và thử lại.');
      error.statusCode = 500;
      throw error;
    } finally {
      await fs.unlink(inputPath).catch(() => {});
    }
  }
}

module.exports = new PiperTtsProvider();
