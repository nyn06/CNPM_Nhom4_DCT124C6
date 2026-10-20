const QRCode = require('qrcode');
const accessService = require('../services/access.service');

class AccessController {
  async createVoucher(req, res, next) {
    try {
      const voucher = await accessService.createVoucher(req.body, `${req.protocol}://${req.get('host')}`);
      const qrSvg = await QRCode.toString(voucher.activationUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 4 });
      res.status(201).json({ ...voucher, qrSvg });
    } catch (error) {
      if (!error.statusCode) return next(Object.assign(new Error('Không tạo được QR. Hãy thử lại.'), { statusCode: 500 }));
      next(error);
    }
  }

  async listVouchers(req, res, next) {
    try { res.json(await accessService.listVouchers()); } catch (error) { next(error); }
  }

  async redeem(req, res, next) {
    try { res.json(await accessService.redeem(req.body)); } catch (error) { next(error); }
  }

  getSession(req, res) {
    res.json(accessService.sessionInfo(req.accessSession));
  }
}

module.exports = new AccessController();
