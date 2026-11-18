# CNPM_Nhom4_DCT124C6

# Vị Giác – Hệ thống hướng dẫn du lịch tự động đa ngôn ngữ

**Vị Giác** là ứng dụng web hỗ trợ hướng dẫn du lịch đa ngôn ngữ, được phát triển trong khuôn khổ đồ án môn **Công nghệ phần mềm (CNPM)**. Hệ thống giúp du khách khám phá các địa điểm tham quan (*Points of Interest – POI*), xem bản đồ tương tác, đọc nội dung giới thiệu bằng nhiều ngôn ngữ và nghe thuyết minh âm thanh khi có dữ liệu phù hợp. Giao diện quản trị riêng hỗ trợ quản lý địa điểm, nội dung và quyền truy cập.

> **Trạng thái dự án:** Đồ án học thuật phục vụ trình diễn và đánh giá. Các chức năng chính đã được kiểm thử trong môi trường phát triển; backend đã khởi chạy và vượt qua kiểm tra sức khỏe trong Docker cục bộ. Quy trình GitHub Actions hiện **build Docker image**, chưa tự động triển khai ứng dụng lên máy chủ production công khai.

## 1. Chức năng chính

### 1.1. Website dành cho du khách

- Xem danh sách địa điểm du lịch (POI) và thông tin chi tiết.
- Tìm kiếm địa điểm và khám phá các POI ở gần dựa trên tọa độ địa lý.
- Xem vị trí địa điểm trên bản đồ tương tác.
- Đọc nội dung giới thiệu bằng **tiếng Việt, tiếng Anh, tiếng Nhật và tiếng Hàn**, tùy theo dữ liệu đã có.
- Phát bản thuyết minh âm thanh đã được tạo hoặc lưu sẵn.
- Sử dụng các chức năng hỗ trợ voucher/QR và kích hoạt quyền truy cập tour theo quy trình hiện có.

### 1.2. Website quản trị

- Đăng nhập tài khoản quản trị và truy cập các chức năng được phân quyền.
- Quản lý địa điểm du lịch và thông tin vị trí.
- Quản lý nội dung giới thiệu đa ngôn ngữ và thuyết minh.
- Quản lý voucher, phiên truy cập của du khách và tài khoản quản trị.
- Xem thông tin tổng quan trên bảng điều khiển (*Dashboard*).

> **Phạm vi hiện tại:** Chất lượng dịch thuật và khả năng tạo giọng nói phụ thuộc vào dịch vụ, mô hình giọng nói và dữ liệu được cấu hình. Quy trình thanh toán phục vụ mục đích trình diễn, **không phải cổng thanh toán thương mại**. Dự án có worker xử lý dịch nền nhưng **chưa có trang quản trị riêng để giám sát processing jobs**.

## 2. Công nghệ sử dụng

| Thành phần | Công nghệ |
| --- | --- |
| Giao diện web | HTML, CSS, JavaScript, Leaflet.js |
| Backend | Node.js 20, Express.js |
| Kiến trúc | 3 lớp: Controller – Service – Repository |
| Cơ sở dữ liệu | Microsoft SQL Server 2022 |
| Dịch thuật | LibreTranslate; DeepL |
| Chuyển văn bản thành giọng nói | Piper TTS và các mô hình giọng nói tương ứng |
| Bản đồ và tìm kiếm vị trí | VietMap, OpenStreetMap Nominatim |
| Kiểm thử | Jest, Supertest |
| Kiểm tra chất lượng mã nguồn | ESLint |
| Tích hợp liên tục (CI) | GitHub Actions |
| Đóng gói và chạy dịch vụ | Docker, Docker Compose |

## 3. Cấu trúc dự án

Mã nguồn ứng dụng được làm việc trong thư mục `be-demo/`. Các thành phần chính gồm:

```text
be-demo/
├── .github/workflows/       # Cấu hình CI (trong repository)
├── src/                     # Express, routes, controllers, services,
│                            # repositories, middleware, workers
├── public/                  # Giao diện du khách và quản trị
│   ├── index.html
│   ├── admin-login.html
│   ├── admin.html
│   ├── css/
│   └── js/
├── database/                # Lược đồ và migration SQL Server
├── tests/                   # Các bài kiểm thử tự động
├── Dockerfile               # Docker image cho backend
├── compose.database.yml     # Dịch vụ SQL Server
├── compose.translation.yml  # Dịch vụ LibreTranslate
├── .env.example             # Mẫu biến môi trường
├── package.json
└── package-lock.json
```

> Cấu trúc đường dẫn có thể khác nhau tùy cách clone repository. Các lệnh bên dưới phải được chạy trong **thư mục chứa `package.json` và `Dockerfile`**.

## 4. Yêu cầu môi trường

- **Node.js 20.x** và npm.
- **Docker Desktop** (khuyến nghị để chạy SQL Server và LibreTranslate).
- Git.
- Terminal hỗ trợ PowerShell hoặc Bash.
- Tùy chọn: Piper TTS và các voice model cần thiết nếu muốn tạo âm thanh trên máy cục bộ.

## 5. Hướng dẫn cài đặt và chạy trên máy

### Bước 1. Clone repository

```bash
git clone https://github.com/nyn06/CNPM_Nhom4_DCT124C6.git
cd CNPM_Nhom4_DCT124C6
```

Nếu ứng dụng nằm trong thư mục con `be-demo`, chuyển vào thư mục đó:

```bash
cd be-demo
```

### Bước 2. Cài đặt thư viện

```bash
npm ci
```

### Bước 3. Cấu hình biến môi trường

Tạo `.env` từ `.env.example`:

**PowerShell:**

```powershell
Copy-Item .env.example .env
```

**Bash:**

```bash
cp .env.example .env
```

Các biến cấu hình tham khảo:

```dotenv
DB_HOST=localhost
DB_PORT=14333
DB_NAME=AutoNarrationDB
DB_USER=sa
DB_PASSWORD=<mat-khau-sql-server-cua-ban>
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true

TRANSLATION_PROVIDER=libretranslate
TRANSLATION_API_URL=http://localhost:5000
TRANSLATION_REQUIRE_API_KEY=false

ADMIN_BOOTSTRAP_USERNAME=<ten-tai-khoan-admin>
ADMIN_BOOTSTRAP_PASSWORD=<mat-khau-admin>
ACTIVATION_CODE_SECRET=<chuoi-bi-mat-ngau-nhien-du-dai>
```

Kiểm tra `.env.example` để biết các cấu hình bổ sung, chẳng hạn API key của VietMap. **Không đưa file `.env`, mật khẩu, API key hoặc secret thật lên GitHub.**

### Bước 4. Khởi động các dịch vụ hỗ trợ

**SQL Server:**

```bash
docker compose -f compose.database.yml up -d
```

**LibreTranslate:**

```bash
docker compose -f compose.translation.yml up -d
```

Cấu hình SQL Server của dự án ánh xạ cổng `1433` trong container sang cổng `14333` trên máy. LibreTranslate sử dụng cổng `5000` khi được cấu hình và khởi chạy phù hợp.

Kiểm tra container:

```bash
docker ps
```

### Bước 5. Chuẩn bị cơ sở dữ liệu

```bash
npm run db:migrate
```

> Chỉ chạy migration trên **database phát triển hoặc kiểm thử** đã xác định rõ. Kiểm tra tên database và thông tin kết nối trong `.env`; sao lưu dữ liệu quan trọng trước khi cập nhật lược đồ.

### Bước 6. Khởi chạy ứng dụng

```bash
npm start
```

Khi backend hoạt động ở cổng mặc định `3000`, truy cập:

| Chức năng | Địa chỉ |
| --- | --- |
| Website du khách | http://localhost:3000/index.html |
| Trang đăng nhập quản trị | http://localhost:3000/admin-login.html |
| Kiểm tra trạng thái backend | http://localhost:3000/health |

Khi ứng dụng và kết nối cơ sở dữ liệu hoạt động bình thường, endpoint `/health` trả về:

```json
{"status":"ok"}
```

Nếu gặp lỗi `EADDRINUSE`, hãy kiểm tra có backend khác đang sử dụng cổng `3000` hay không trước khi khởi chạy thêm một tiến trình.

## 6. Đóng gói và kiểm tra backend bằng Docker

### 6.1. Build Docker image

```bash
docker build -t auto-narration-be:local .
```

### 6.2. Chạy backend container trên Windows (Docker Desktop)

Ví dụ dưới đây sử dụng cổng `3001` của máy và kết nối tới SQL Server đã mở ở cổng `14333`:

```powershell
docker run -d `
  --name auto-narration-be-check `
  -p 127.0.0.1:3001:3000 `
  --env-file .env `
  -e DB_HOST=host.docker.internal `
  -e DB_PORT=14333 `
  auto-narration-be:local
```

> Lệnh dùng database được khai báo trong `.env`. Nên sử dụng database phát triển/kiểm thử thay vì database production.

### 6.3. Kiểm tra container và HTTP health check

```powershell
docker ps --filter "name=auto-narration-be-check"
docker logs --tail 30 auto-narration-be-check

$response = Invoke-WebRequest -Uri "http://localhost:3001/health" -UseBasicParsing
Write-Host "HTTP Status:" $response.StatusCode
Write-Host "Response:" $response.Content
```

Trong lần kiểm chứng của nhóm, backend Docker đã chạy thành công và trả về:

```text
HTTP Status: 200
Response: {"status":"ok"}
```

**Lưu ý về mạng Docker:** `localhost` bên trong container không phải là `localhost` trên Windows. Khi backend Docker cần kết nối các dịch vụ bên ngoài container, phải dùng địa chỉ phù hợp như `host.docker.internal` (trên Docker Desktop) hoặc mạng Docker được cấu hình riêng. Cấu hình Piper TTS trên Windows cũng có thể cần điều chỉnh để hoạt động trong Docker Linux.

Dừng riêng container kiểm tra backend:

```bash
docker stop auto-narration-be-check
```

Lệnh này không dừng container SQL Server hoặc LibreTranslate.

## 7. Kiểm thử và chất lượng mã nguồn

Các lệnh thường dùng:

```bash
npm test                    # Chạy bộ kiểm thử Jest thông thường
npm run test:db             # Kiểm thử tích hợp SQL Server
npm run lint --if-present   # Kiểm tra ESLint
```

**Kết quả ghi nhận trong báo cáo của phiên bản đã kiểm thử:**

| Chỉ số | Kết quả |
| --- | --- |
| Bộ kiểm thử Jest thông thường | **39 test suites, 913 tests passed** |
| Kiểm thử tích hợp SQL Server | **11 tests passed** |
| Statement coverage | **87.37%** |
| Branch coverage | **81.51%** |
| Function coverage | **91.93%** |
| Line coverage | **88.68%** |

Các tỷ lệ coverage áp dụng cho **phần mã nguồn được đo trong lần chạy Jest tương ứng**, không mặc định bao phủ mọi file trong repository. Cần chạy lại kiểm thử khi mã nguồn thay đổi.

## 8. CI/CD với GitHub Actions

Workflow GitHub Actions được kích hoạt khi `push` hoặc tạo `pull request` vào nhánh `main`. Quy trình gồm ba job chính:

1. **Build & Test:** cài đặt dependencies trên Node.js 20.x, kiểm tra thư viện native, chạy ESLint, Jest và thu thập coverage.
2. **SQL Server integration:** khởi tạo SQL Server 2022 cô lập, chạy database migrations và kiểm thử tích hợp.
3. **Deploy:** sau khi hai job trước thành công và có `push` vào `main`, tiến hành build Docker image theo Git commit.

**Quan trọng:** Job `Deploy` hiện mới **đóng gói Docker image**; bước triển khai production vẫn là placeholder. Việc workflow chạy thành công **không đồng nghĩa website đã được public lên Internet**.

[Xem GitHub Actions của dự án](https://github.com/nyn06/CNPM_Nhom4_DCT124C6/actions)

## 9. Hạn chế và hướng phát triển

- Nâng cao tính tương thích của Piper TTS và các mô hình giọng nói giữa các môi trường, đặc biệt là Docker Linux.
- Tăng độ ổn định và khả năng dự phòng của dịch vụ dịch thuật, tìm kiếm địa điểm và định vị.
- Tích hợp cổng thanh toán thực tế thay cho quy trình thanh toán phục vụ trình diễn.
- Xây dựng giao diện quản trị giám sát các tác vụ dịch thuật chạy nền (*processing jobs*).
- Bổ sung triển khai production, HTTPS, quản lý secret, logging và kiểm tra sau triển khai.
- Thực hiện load testing, stress testing và tối ưu hiệu năng cho số lượng người dùng lớn.

## 10. Lưu ý bảo mật

- Không commit `.env`, mật khẩu, API key, token hoặc các secret lên GitHub.
- Ưu tiên dùng database riêng cho phát triển và kiểm thử.
- Không sử dụng thông tin đăng nhập demo trên môi trường public.
- Thay mới ngay các khóa hoặc secret bị lộ trong ảnh chụp, log hay commit.
- Rà soát cấu hình xác thực, HTTPS, quyền truy cập và các API bên ngoài trước khi triển khai chính thức.

## 11. Thông tin đồ án

- **Tên dự án:** Vị Giác – Hệ thống hướng dẫn du lịch tự động đa ngôn ngữ.
- **Học phần:** Công nghệ phần mềm (CNPM).
- **Mục đích:** Xây dựng và kiểm chứng website hướng dẫn du lịch sử dụng dữ liệu địa điểm, bản đồ, dịch thuật và thuyết minh đa ngôn ngữ.
- **Mã nguồn:** [CNPM_Nhom4_DCT124C6](https://github.com/nyn06/CNPM_Nhom4_DCT124C6).

