
'use strict';

const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const poiService = require('./poi.service');

const IMAGE_DIRECTORY = path.join(
  __dirname,
  '..',
  '..',
  'uploads',
  'pois'
);

const ALLOWED_EXTENSIONS = new Set([
  'jpg',
  'png',
  'webp',
]);

async function savePoiImage(poiId, image) {
  // Kiểm tra POI tồn tại trước khi ghi tệp.
  await poiService.getPoi(poiId);

  if (
    !image ||
    !Buffer.isBuffer(image.buffer) ||
    !ALLOWED_EXTENSIONS.has(image.extension)
  ) {
    const error = new Error('Dữ liệu ảnh POI không hợp lệ.');
    error.statusCode = 400;
    throw error;
  }

  const filename = `${randomUUID()}.${image.extension}`;
  const imagePath = path.join(IMAGE_DIRECTORY, filename);
  const imageUrl = `/uploads/pois/${filename}`;

  await fs.mkdir(IMAGE_DIRECTORY, { recursive: true });

  // wx: Không ghi đè tệp đã tồn tại.
  await fs.writeFile(imagePath, image.buffer, { flag: 'wx' });

  try {
    // Chỉ cập nhật đường dẫn ảnh.
    const updatedPoi = await poiService.updatePoi(poiId, {
      imageUrl,
    });

    if (!updatedPoi) {
      const error = new Error('Không tìm thấy POI');
      error.statusCode = 404;
      throw error;
    }

    return {
      poiId: updatedPoi.id,
      imageUrl: updatedPoi.imageUrl,
    };
  } catch (error) {
    // Nếu cập nhật SQL thất bại, xóa tệp vừa tạo.
    try {
      await fs.unlink(imagePath);
    } catch (cleanupError) {
      console.error('Không thể dọn dẹp ảnh POI:', cleanupError);
    }

    throw error;
  }
}

module.exports = {
  savePoiImage,
};
