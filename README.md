# CNPM_Nhom4_DCT124C6

Backend Node.js + Express và WebApp HTML/CSS/Vanilla JS cho đồ án **Hệ thống thuyết minh tự động đa ngôn ngữ dựa trên vị trí**. Demo hiện dùng địa điểm ẩm thực. Giai đoạn 4 bổ sung **nội dung TEXT VI/EN/JA/KO**; khu vực audio vẫn là placeholder.

## Chạy và kiểm tra

Yêu cầu Node.js 18+ (provider dùng `fetch` tích hợp). Trên PowerShell:

```powershell
Set-Location 'D:\SUBJECTS FOR IT\CNPM\be-demo-3layer-cicd\be-demo'
# Chạy npm.cmd ci nếu máy chưa có dependencies.
npm.cmd start
```

Mở http://localhost:3000. Repository dùng Map trong bộ nhớ, dữ liệu mất khi restart. Chỉ bật GPS thật khi người dùng bấm nút; GPS giả lập dùng cùng API nearby. GPS thật cần HTTPS hoặc localhost.

```powershell
npm.cmd test
npm.cmd run lint
```

Tests mock provider và HTTP, không cần API key, không gọi dịch vụ dịch thật. CI/CD không thay đổi. Hai warning ESLint cũ ở `errorHandler.js` và `job.service.js` được giữ nguyên.

## Dữ liệu và kiến trúc Giai đoạn 4

`description` là mô tả ngắn; `narrations` lưu nội dung dài theo ngôn ngữ:

```json
{
  "narrations": {
    "vi": { "text": "Nội dung gốc tiếng Việt" },
    "en": { "text": "Nội dung EN nhận từ provider" },
    "ja": { "text": "Nội dung JA nhận từ provider" },
    "ko": { "text": "Nội dung KO nhận từ provider" }
  }
}
```

Trên đây chỉ minh họa cấu trúc, không phải dữ liệu dịch demo. POI cũ chưa có `narrations` vẫn hoạt động; GET tất cả nội dung trả `{}`. Nhập VI qua endpoint riêng, không thông qua POI CRUD. Nguồn ngôn ngữ dùng chung duy nhất là `public/js/poi-languages.js`: Node require và WebApp cùng đọc file này. Endpoint `/api/languages` của module Job không đổi.

Luồng: Routes → Controller → POI Service → Translation Provider → HTTP API. Service lưu kết quả qua Repository sau khi dịch thành công; Controller và Repository không gọi dịch vụ ngoài.

Provider ở `src/integrations/translation/translation.provider.js`, giao diện `translate(text, sourceLanguage, targetLanguage)` trả `{ text }`. POI Service không phụ thuộc cấu trúc HTTP LibreTranslate; có thể thay implementation của provider sau này.

## Cấu hình provider thật

Chọn **LibreTranslate tự host**: có mã nguồn mở và giao thức HTTP đơn giản, có thể dùng instance do bạn/nhóm quản lý. Không chọn mặc định một endpoint công cộng, không đăng ký tài khoản, không tạo key hoặc dịch vụ trả phí. LibreTranslate.com là dịch vụ hosting cần key riêng, không phải endpoint miễn phí mặc định.

- Instance tự host có thể không cần API key; nếu bật xác thực, điền key và đặt `TRANSLATION_REQUIRE_API_KEY=true`.
- Không có quota/free tier chung cho mọi instance tự host: giới hạn request, ký tự và tài nguyên do người vận hành cấu hình.
- Instance cần có các model/cặp dịch VI → EN/JA/KO (có thể qua pivot). Kiểm tra `/languages` của instance trước khi demo; chỉ có bốn mã trong dropdown không đảm bảo server dịch đã cài đủ model.
- Tham khảo chính thức: [API usage](https://docs.libretranslate.com/guides/api_usage/), [translate API](https://docs.libretranslate.com/api/operations/translate/), [API keys](https://docs.libretranslate.com/guides/manage_api_keys/), [FAQ](https://docs.libretranslate.com/guides/faq/).

| Biến | Ý nghĩa |
| --- | --- |
| `TRANSLATION_PROVIDER` | `libretranslate` |
| `TRANSLATION_API_URL` | URL đầy đủ tới endpoint `/translate` của instance thật; bắt buộc |
| `TRANSLATION_API_KEY` | Key của instance nếu yêu cầu; có thể để trống với self-host không xác thực |
| `TRANSLATION_REQUIRE_API_KEY` | `true` hoặc `false`, mặc định `false`; hostname libretranslate.com luôn cần key |
| `TRANSLATION_TIMEOUT_MS` | Số nguyên 1–60000 ms, mặc định 10000, bao gồm đọc response body |

URL phải là HTTP/HTTPS, không chứa credentials, query hoặc fragment. API key đi trong JSON body; dùng HTTPS khi gọi instance từ xa. Redirect bị từ chối. Không log key, không đưa URL/body/lỗi gốc từ provider ra response.

### Dùng `.env` với Node.js 20.6+

`.env.example` là template, `.env` thật được Git ignore. Không commit key. Project không dùng dotenv; **`npm start` không tự đọc `.env`**.

```powershell
Set-Location 'D:\SUBJECTS FOR IT\CNPM\be-demo-3layer-cicd\be-demo'
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
# Sửa .env bằng editor, điền URL/key của instance mà bạn có quyền dùng.
# Nếu server đang chạy, Ctrl+C trong terminal của server rồi khởi động lại:
node --env-file=.env src/server.js
```

Ví dụ cấu hình **chỉ khi** đã có instance tự host chạy ở cổng 5000:

```dotenv
TRANSLATION_PROVIDER=libretranslate
TRANSLATION_API_URL=http://localhost:5000/translate
TRANSLATION_API_KEY=
TRANSLATION_REQUIRE_API_KEY=false
TRANSLATION_TIMEOUT_MS=10000
```

Không có instance/key thì vẫn chạy `npm.cmd start`: POI, GPS, lưu/đọc VI và WebApp hoạt động. API tạo bản dịch trả JSON **503** rõ ràng khi thiếu cấu hình, không làm server crash.

### Node.js 18 hoặc dùng biến môi trường PowerShell

```powershell
$env:TRANSLATION_PROVIDER = 'libretranslate'
# Ví dụ này yêu cầu instance tự host đang chạy; thay bằng endpoint thật của bạn.
$env:TRANSLATION_API_URL = 'http://localhost:5000/translate'
$env:TRANSLATION_REQUIRE_API_KEY = 'false'
$env:TRANSLATION_TIMEOUT_MS = '10000'
# Nếu instance cần key: cấu hình TRANSLATION_API_KEY trong môi trường, đổi REQUIRE_API_KEY thành true.
npm.cmd start
```

## API mới

| Method và đường dẫn | Body | Kết quả |
| --- | --- | --- |
| `PUT /api/pois/:id/narrations/vi` | `{ "text": "..." }` | `{ poiId, language: "vi", text, updatedAt }` |
| `POST /api/pois/:id/translations` | `{ "targetLanguages": ["en", "ja", "ko"] }` | `{ poiId, sourceLanguage: "vi", translations }` |
| `GET /api/pois/:id/narrations/:language` | Không | `{ poiId, language, text }` |
| `GET /api/pois/:id/narrations` | Không | `{ poiId, narrations }` |

Các API thành công trả 200. Lỗi giữ convention `{ "error": "..." }`:

- 400: VI thiếu/sai kiểu/rỗng sau trim; language không hỗ trợ; targetLanguages thiếu, không phải mảng, rỗng, trùng lặp, chứa `vi` hoặc ngoài EN/JA/KO; chưa lưu VI trước khi dịch.
- 404: POI không tồn tại hoặc chưa có narration của ngôn ngữ yêu cầu. Không fallback sang ngôn ngữ khác.
- 503: thiếu/sai cấu hình hoặc provider từ chối xác thực (401/403).
- 504: provider quá timeout.
- 502: lỗi mạng/HTTP khác, JSON sai, text rỗng hoặc response không hợp lệ.
- 409: VI thay đổi trong lúc chờ dịch; client cần dịch lại nguồn mới.

**Atomic update:** gọi provider cho từng target, chờ tất cả thành công rồi mới ghi repository đúng một lần. Một target lỗi thì không ghi bất kỳ bản dịch nào của request đó; giữ cả các bản dịch cũ. Các request provider còn lại có thể hoàn thành nhưng không được lưu. Không có retry/queue.

Sửa VI sang text khác sẽ xóa bản dịch cũ để tránh hiển thị nội dung không còn khớp nguồn. Gửi lại cùng VI sau trim giữ bản dịch. Kiểm tra lại POI sau khi chờ dịch giúp không khôi phục POI đã xóa; merge với trạng thái mới nhất giữ thay đổi CRUD và bản dịch ngôn ngữ khác được lưu đồng thời.

Routes narration/translations và `/pois/nearby` không bị `/pois/:id` bắt nhầm, có regression tests. Thuật toán Haversine/geofence và CRUD cũ không thay đổi. Job/Narration/Piper/audio pipeline cũ không chỉnh sửa.

## WebApp

Khi nearby trả một POI trong geofence, WebApp GET `/api/pois/{id}/narrations/{language}` và hiển thị text dưới tiêu đề ngôn ngữ tương ứng. Đổi dropdown khi đang ở POI chỉ tải narration của chính POI đó, không gọi lại GPS/nearby. Frontend chỉ gọi Backend, không giữ key và không tự tạo translation.

Khi thiếu nội dung, hiển thị “Chưa có nội dung thuyết minh cho ngôn ngữ này.” Có nút thử tải lại khi lỗi/thiếu. Nội dung cũ được xóa khi đổi ngôn ngữ/vị trí; hủy request cũ và kiểm tra số thứ tự để kết quả đến muộn không ghi đè. Text dùng `textContent`, giữ xuống dòng và không thực thi HTML. Audio vẫn là placeholder với nút disabled.

## Demo PowerShell A–F

Giữ server chạy ở terminal thứ nhất. Terminal thứ hai:

```powershell
Set-Location 'D:\SUBJECTS FOR IT\CNPM\be-demo-3layer-cicd\be-demo'
& '.\scripts\demo-poi-narrations.ps1'
# Nếu policy của máy chặn script: chạy trực tiếp các lệnh A–F bên dưới.
```

Script tạo POI thật trong bộ nhớ, lưu VI, thử dịch EN/JA/KO, đọc lại kết quả và in tọa độ/ID. Nếu provider chưa cấu hình hoặc lỗi, script báo lỗi và giữ VI để demo, không chèn bản dịch giả. Có thể chỉ kiểm tra VI bằng `-SkipTranslation`. Mỗi lần chạy tạo một POI mới; nếu nhiều POI cùng tọa độ, dùng tọa độ riêng bằng `-Latitude`/`-Longitude` hoặc restart server demo rồi chạy lại.

Toàn bộ lệnh tương đương, chạy sau khi cấu hình provider và khởi động server:

```powershell
$base = 'http://localhost:3000/api'
$contentType = 'application/json; charset=utf-8'

# A. Tạo POI
$body = @{
    name = 'Phở Việt Nam'
    description = 'Điểm trải nghiệm món phở Việt Nam.'
    category = 'food'
    address = 'TP. Hồ Chí Minh'
    latitude = 10.7769
    longitude = 106.7009
    geofenceRadius = 80
    isActive = $true
} | ConvertTo-Json
$poi = Invoke-RestMethod -Method Post -Uri "$base/pois" -ContentType $contentType -Body ([Text.Encoding]::UTF8.GetBytes($body))
$id = $poi.id

# B. Thêm thuyết minh tiếng Việt
$body = @{ text = 'Phở là một trong những món ăn truyền thống nổi tiếng của Việt Nam. Một bát phở gồm bánh phở, nước dùng thơm và thịt bò hoặc thịt gà, ăn kèm rau thơm.' } | ConvertTo-Json
Invoke-RestMethod -Method Put -Uri "$base/pois/$id/narrations/vi" -ContentType $contentType -Body ([Text.Encoding]::UTF8.GetBytes($body))

# C. Kiểm tra VI
Invoke-RestMethod -Uri "$base/pois/$id/narrations/vi"

# D. Dịch thật — cần provider đã cấu hình, không dùng mock
$body = @{ targetLanguages = @('en', 'ja', 'ko') } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/pois/$id/translations" -ContentType $contentType -Body ([Text.Encoding]::UTF8.GetBytes($body))

# E. Đọc lại từng ngôn ngữ và tất cả
Invoke-RestMethod -Uri "$base/pois/$id/narrations/en"
Invoke-RestMethod -Uri "$base/pois/$id/narrations/ja"
Invoke-RestMethod -Uri "$base/pois/$id/narrations/ko"
Invoke-RestMethod -Uri "$base/pois/$id/narrations" | ConvertTo-Json -Depth 6

# F. Kiểm tra geofence và WebApp
Invoke-RestMethod -Uri "$base/pois/nearby?lat=10.7769&lng=106.7009" | ConvertTo-Json -Depth 6
```

Mở http://localhost:3000 → Tải lại danh sách → dùng tọa độ Phở Việt Nam → Kiểm tra vị trí giả lập. Đổi **VI → EN → JA → KO**; mỗi lựa chọn phải hiển thị nội dung đã lưu tương ứng, không cần bật lại GPS. Nếu chưa cấu hình provider, chỉ VI có nội dung, các ngôn ngữ khác hiện thông báo thiếu; luồng bản dịch thật cần chạy lại bước D–F sau khi cấu hình.

Giai đoạn 4 dừng ở text. Không thêm TTS, audio, auth/admin, bản đồ, database hoặc chức năng ngoài phạm vi.
