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
};

class PiperTtsProvider {
  async synthesize(text, language) {
    const voice = VOICE_CONFIG[language];

    if (!voice) {
      throw new Error(
        `Piper chưa cấu hình ngôn ngữ: ${language}`
      );
    }

    const rootDir = process.cwd();

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

    await fs.mkdir(audioDir, { recursive: true });
    await fs.mkdir(tempDir, { recursive: true });

    const outputPath = path.join(
      audioDir,
      fileName
    );

    const inputPath = path.join(
      tempDir,
      `tts_${id}.txt`
    );

    await fs.writeFile(
      inputPath,
      text,
      {
        encoding: 'utf8',
      }
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
      await new Promise((resolve, reject) => {
        execFile(
          piperPath,
          args,
          {
            encoding: 'utf8',
          },
          (error, stdout, stderr) => {
            if (error) {
              console.error('Piper error:', stderr);
              reject(error);
              return;
            }

            resolve();
          }
        );
      });

      return fileName;
    } finally {
      await fs.unlink(inputPath).catch(() => {});
    }
  }
}

module.exports = new PiperTtsProvider();