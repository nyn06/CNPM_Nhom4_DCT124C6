require('dotenv').config();

const request = require('supertest');
const app = require('../src/app');
const poiService = require('../src/services/poi.service');
const translationService = require('../src/services/poi-translation.service');
const pois = require('../src/repositories/poi.repository');
const translations = require('../src/repositories/poi-translation.repository');
const { closePool } = require('../src/database/connection');

async function main() {
  let id;
  let createdAt;
  try {
    const created = await poiService.createPoi({ name: 'Hủ Tiếu',
      description: 'Hủ Tiếu là món ăn quen thuộc của miền Nam.',
      category: 'food', address: '40 Đường Tú Xương, Phường Xuân Hòa, Thành phố Hồ Chí Minh',
      streetAddress: '40 Đường Tú Xương', ward: 'Phường Xuân Hòa', city: 'Thành phố Hồ Chí Minh',
      latitude: 10.8, longitude: 106.7, geofenceRadius: 30, isActive: false });
    id = created.id;
    createdAt = created.createdAt;
    await translationService.translate(id, { targetLanguages: ['en'] });
    const first = (await request(app).get(`/api/pois/${id}?lang=en`));
    if (first.status !== 200 || first.body.name !== 'Hu Tieu'
      || !first.body.description || first.body.description === created.description
      || first.body.address !== '40 Tu Xuong Street, Xuan Hoa Ward, Ho Chi Minh City') {
      throw new Error('English API did not return the expected translated fields.');
    }
    const updatedDescription = 'Hủ Tiếu là món ăn quen thuộc của miền Nam với nước dùng thơm ngon.';
    await poiService.updatePoi(id, { description: updatedDescription });
    const stale = (await request(app).get(`/api/pois/${id}?lang=en`)).body;
    if (stale.description !== updatedDescription) throw new Error('Stale description was shown as translated.');
    await translationService.translate(id, { targetLanguages: ['en'] });
    const second = (await request(app).get(`/api/pois/${id}?lang=en`)).body;
    const row = (await translations.findByPoiIds([id])).find((entry) => entry.language === 'en');
    if (!row || second.description === stale.description || second.description !== row.description)
      throw new Error('Updated description was not stored and served.');
    process.stdout.write(`${JSON.stringify({ ok: true, id, name: second.name,
      address: second.address, description: second.description, updated: true })}\n`);
  } finally {
    if (id) {
      const current = await pois.findById(id);
      if (current) {
        if (current.name !== 'Hủ Tiếu' || current.createdAt !== createdAt)
          throw new Error(`Cleanup stopped: unexpected POI identity for ${id}`);
        await poiService.deletePoi(id);
      }
      if (await pois.findById(id)) throw new Error(`Cleanup failed for ${id}`);
      process.stdout.write(`Cleaned up test POI ${id}\n`);
    }
    await closePool();
  }
}

main().catch((error) => { console.error(`Live POI translation check failed: ${error.code || error.message}`); process.exitCode = 1; });
