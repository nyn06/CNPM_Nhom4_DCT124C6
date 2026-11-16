
'use strict';

const multer = require('multer');
const sharp = require('sharp');

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_SIZE,
    files: 1,
    fields: 0,
    parts: 1,
  },
}).single('image');

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;

  // JPEG
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'jpg';
  }

  // PNG
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    )
  ) {
    return 'png';
  }

  // WebP
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }

  return null;
}


function uploadPoiImage(req, res, next) {
  upload(req, res, async (err) => {
    if (err) {
      const error = new Error(
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Ảnh POI không được vượt quá 5 MB.'
          : 'Dữ liệu tải ảnh POI không hợp lệ.'
      );

      error.statusCode =
        err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;

      return next(error);
    }

    if (!req.file) {
      const error = new Error('Vui lòng chọn ảnh POI.');
      error.statusCode = 400;
      return next(error);
    }

    const imageType = detectImageType(req.file.buffer);

    if (!imageType) {
      const error = new Error(
        'Chỉ chấp nhận ảnh JPG, PNG hoặc WebP.'
      );
      error.statusCode = 400;
      return next(error);
    }

    try {
      const image = sharp(req.file.buffer, {
        failOn: 'error',
        limitInputPixels: 25000000,
        animated: false,
      });

      const metadata = await image.metadata();

      const actualType =
        metadata.format === 'jpeg' ? 'jpg' : metadata.format;

      if (
        actualType !== imageType ||
        !['jpg', 'png', 'webp'].includes(actualType) ||
        !metadata.width ||
        !metadata.height ||
        (metadata.pages || 1) !== 1
      ) {
        const error = new Error('Nội dung ảnh POI không hợp lệ.');
        error.statusCode = 400;
        return next(error);
      }

      const normalizedBuffer = await sharp(req.file.buffer, {
        failOn: 'error',
        limitInputPixels: 25000000,
        animated: false,
      })
        .rotate()
        .toFormat(metadata.format)
        .toBuffer();

      if (normalizedBuffer.length > MAX_IMAGE_SIZE) {
        const error = new Error(
          'Ảnh POI sau xử lý không được vượt quá 5 MB.'
        );
        error.statusCode = 413;
        return next(error);
      }

      req.poiImage = {
        buffer: normalizedBuffer,
        extension: actualType,
      };

      return next();
    } catch (error) {
      if (error.statusCode) return next(error);

      const invalidImage = new Error(
        'Không thể đọc hoặc xử lý ảnh POI.'
      );
      invalidImage.statusCode = 400;
      return next(invalidImage);
    }
  });
}


module.exports = uploadPoiImage;
