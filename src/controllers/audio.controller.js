const audioService = require('../services/audio.service');
const accessService = require('../services/access.service');

async function serveAudio(req, res, next) {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.set('Allow', 'GET, HEAD');
      return res.status(405).json({ error: 'Audio chỉ hỗ trợ GET hoặc HEAD.' });
    }
    const filename = decodeURIComponent(req.path.slice(1));
    const file = await audioService.resolveAudio(filename, req.demoAdmin === true);
    // Recheck after filesystem await, so expiration during lookup is rejected.
    if (!req.demoAdmin) accessService.validateAuthorization(req.get('authorization'));
    res.type('audio/wav');
    res.set('Cache-Control', 'no-store');
    res.sendFile(file, { cacheControl: false, lastModified: false }, (error) => {
      if (!error || res.headersSent) return;
      res.removeHeader('Content-Type');
      next(Object.assign(new Error(error.statusCode === 416
        ? 'Khoảng audio không hợp lệ.' : 'Không tải được audio.'), { statusCode: error.statusCode === 416 ? 416 : 404 }));
    });
  } catch (error) {
    if (error instanceof URIError) return next(Object.assign(new Error('Đường dẫn audio không hợp lệ.'), { statusCode: 400 }));
    next(error);
  }
}

module.exports = serveAudio;
