# Demo BE — Thuyết minh tự động đa ngôn ngữ (3-Layer + CI/CD)

Đây là bản demo backend minh họa **kiến trúc 3 lớp** và **pipeline CI/CD**,
dùng chung ý tưởng nghiệp vụ với đề tài "Thuyết minh tự động đa ngôn ngữ".

## 1. Kiến trúc 3 lớp

```
Client (Postman / Swagger / FE)
        │  HTTP request
        ▼
┌───────────────────────┐
│  CONTROLLER LAYER      │  src/controllers/  — nhận request, trả response
├───────────────────────┤
│  SERVICE LAYER         │  src/services/     — xử lý nghiệp vụ, gọi STT/Dịch/TTS
├───────────────────────┤
│  REPOSITORY LAYER      │  src/repositories/ — đọc/ghi dữ liệu
└───────────────────────┘
```

Nguyên tắc: **Controller không được gọi thẳng Repository**, mà phải qua Service.
Service không biết dữ liệu lưu ở đâu (Map, MySQL...), chỉ gọi qua Repository.
=> Khi đổi database thật, chỉ cần sửa file trong `repositories/`, không đụng vào
Controller hay Service.

## 2. API demo

| Method | Endpoint             | Mô tả                                   |
|--------|-----------------------|------------------------------------------|
| GET    | `/health`             | Kiểm tra server sống                     |
| GET    | `/api/languages`      | Danh sách ngôn ngữ hỗ trợ                |
| POST   | `/api/jobs`           | Tạo job thuyết minh mới                  |
| GET    | `/api/jobs`           | Danh sách toàn bộ job                    |
| GET    | `/api/jobs/:id`       | Tra cứu 1 job (xem đã xử lý xong chưa)   |

Ví dụ tạo job:
```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"fileName":"bai_giang.mp4","targetLang":"en"}'
```

Luồng xử lý (mô phỏng, chưa nối API AI thật):
`Speech-to-Text (mock) → Translate (mock) → Text-to-Speech (mock)`,
chạy nền ~1.5s rồi chuyển trạng thái job từ `processing` → `done`.

Khi làm đồ án thật, chỉ cần thay 3 hàm `mockSpeechToText`, `mockTranslate`,
`mockTextToSpeech` trong `src/services/job.service.js` bằng lời gọi API thật
(Google Cloud Speech-to-Text, Google Translate, Google/Amazon TTS...).

## 3. Chạy thử

```bash
npm install
npm start          # chạy server tại http://localhost:3000
npm test           # chạy toàn bộ unit test
```

## 4. CI/CD (`.github/workflows/ci-cd.yml`)

- **CI**: mỗi lần push / tạo Pull Request → tự động cài dependencies,
  lint code, chạy toàn bộ unit test trên 2 phiên bản Node.js.
- **CD**: khi merge vào nhánh `main` và CI pass → tự động build Docker image
  (bước deploy thật lên server/VPS bạn tự thay vào phần placeholder).

## 5. Gợi ý phân công nhóm 2-3 người

- **Người 1**: Controller + Routes + viết API docs
- **Người 2**: Service (xử lý nghiệp vụ, sau này nối API AI thật)
- **Người 3**: Repository + Database thật (thay Map bằng PostgreSQL/MySQL) + CI/CD

## 6. Việc cần làm tiếp để hoàn thiện đồ án thật

1. Thay Repository in-memory bằng database thật (PostgreSQL/MySQL + ORM)
2. Nối API AI thật cho STT / Dịch / TTS
3. Thêm xác thực (JWT) nếu cần phân quyền người dùng
4. Thêm Swagger UI để giáo viên/nhóm khác test API dễ hơn
5. Hoàn thiện bước deploy thật trong CI/CD (SSH lên VPS, hoặc dùng Render/Railway)
