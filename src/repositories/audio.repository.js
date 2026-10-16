const fs = require('fs/promises');
const path = require('path');
const audioRoot = path.resolve(__dirname, '../../public/audio');

class AudioRepository {
  async resolveFile(filename) {
    try {
      const root = await fs.realpath(audioRoot);
      const file = await fs.realpath(path.join(root, filename));
      if (path.dirname(file) !== root || !(await fs.stat(file)).isFile()) return null;
      return file;
    } catch { return null; }
  }
}

module.exports = new AudioRepository();
