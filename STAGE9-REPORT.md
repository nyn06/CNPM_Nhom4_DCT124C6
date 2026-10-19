**Stage 9 — Authentication & RBAC**

Đã triển khai theo Controller → Service → Repository, JavaScript CommonJS và frontend vanilla. Không commit/push, không thay README, không database/JWT, không thay provider dịch/Piper hay luồng vé khách Stage 8.

**Khảo sát và phạm vi bảo vệ**

| Đường truy cập | Quyền sau Stage 9 |
| --- | --- |
| `GET /admin.html` | Cookie hợp lệ; thiếu/hết phiên chuyển về `/admin-login.html` |
| `GET /admin-login.html` | Công khai, không tự đăng nhập |
| `GET /api/admin/pois`, `GET /api/admin/pois/:id` | ADMIN hoặc POI_MANAGER; đây là các đường đọc quản trị riêng |
| `POST /api/pois`, `PUT/DELETE /api/pois/:id` | ADMIN hoặc POI_MANAGER + CSRF |
| `PUT /api/pois/:id/narrations/vi` | ADMIN hoặc POI_MANAGER + CSRF |
| `POST /api/pois/:id/translations` | ADMIN hoặc POI_MANAGER + CSRF |
| `POST /api/pois/:id/narrations/:language/audio` | ADMIN hoặc POI_MANAGER + CSRF |
| `GET /api/pois/:id/narrations`, `GET /api/pois/:id/narrations/:language` | Cookie quản trị hoặc Bearer khách hợp lệ; Bearer được kiểm tra độc lập và chỉ bao phủ POI active |
| `GET/HEAD /api/admin/audio/:file` | Cookie ADMIN hoặc POI_MANAGER; kiểm tra lại phiên sau filesystem lookup, hỗ trợ Range |
| `GET/POST /api/access/vouchers` | Chỉ ADMIN; POST cần CSRF |
| `GET/POST /api/narrations`, `GET /api/narrations/:id` | ADMIN hoặc POI_MANAGER; POST cần CSRF |
| `GET/POST /api/jobs`, `GET /api/jobs/:id` | ADMIN hoặc POI_MANAGER; POST cần CSRF. Đây là module job nội bộ legacy |
| `/api/accounts` và các mutation accounts | Chỉ ADMIN; mutation cần CSRF |
| `/health`, `/api/languages`, public POI list/detail/nearby | Giữ công khai; public POI response không chứa narration/audio metadata |
| `POST /api/access/redeem`, `GET /api/access/session`, `/audio/:file` | Giữ voucher/Bearer khách Stage 8; cookie Admin không thay thế vé tại `/audio` |

Chỉ serve HTML qua route cụ thể và asset trong `/css`, `/js`. CSS/JS chứa mã giao diện công khai, không chứa thông tin tài khoản hay secret. Không serve static toàn bộ `public`; các alias mã hóa của WAV/Admin HTML không mở đường đọc file. `demoAdmin.js` chỉ còn compatibility export tới authenticator thật, không route production nào dùng cơ chế demo. `NODE_ENV`, localhost, `DEMO_ADMIN_ENABLED`, `X-Demo-Admin` không cấp quyền.

**Authentication, cookie và CSRF**

- Username được chuẩn hóa lowercase, 3–64 ký tự ASCII chữ/số/`._-`; không cho khoảng trắng. Mật khẩu ít nhất 12 ký tự, tối đa 72 byte UTF-8; không trim mật khẩu.
- Băm bcrypt cost 12 bằng `bcryptjs`, salt riêng cho mỗi mật khẩu. Chọn implementation JavaScript để không cần native build trên Windows/Node 18/20 CI. Từ chối đầu vào quá 72 byte thay vì bị bcrypt cắt ngầm. [Tài liệu bcryptjs](https://github.com/dcodeIO/bcrypt.js/).
- Mã phiên ngẫu nhiên 32 byte từ `crypto.randomBytes`; repository chỉ lưu SHA-256 token, user ID, version tài khoản, hạn và CSRF token. CSRF token là token kiểm tra yêu cầu, không phải credential đăng nhập.
- Cookie `admin_session`: HttpOnly, SameSite=Strict, Path=/, không Domain; Secure khi HTTPS hoặc production. Phiên có hạn tuyệt đối 60 phút, do backend quyết định; không gia hạn tự động. Token Admin không xuất hiện trong JSON, URL hay Web Storage.
- Login dùng thông báo chung cho sai username, sai mật khẩu và tài khoản khóa. Username không tồn tại vẫn chạy bcrypt comparison với dummy hash.
- `GET /api/auth/csrf` cấp context trước login qua cookie HttpOnly `admin_login_csrf`, có hạn 10 phút; trả CSRF token cho JavaScript giữ trong bộ nhớ. Login phải gửi context cookie và header `X-CSRF-Token`. Thành công tiêu thụ context, đổi session ID và CSRF token.
- Request mutation bằng cookie, kể cả login/logout, cần JSON và CSRF token gắn với context/phiên. Đồng thời kiểm tra Origin chính xác và từ chối Fetch Metadata cross-site. SameSite là lớp bổ sung; không thay cho CSRF token. Non-browser client thiếu Origin vẫn phải có token đúng và cookie tương ứng. [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
- Logout xóa session ở server và xóa cookie. Đổi role, khóa/mở khóa hoặc reset password tăng version tài khoản và thu hồi tất cả phiên của tài khoản đó. Kiểm tra account/version trên mỗi request, không tin role do client gửi.
- Không trả password/hash qua API; không log credential/session token. Bootstrap password được bỏ khỏi môi trường process sau bootstrap để tiến trình Piper con không kế thừa nó.

**Giới hạn bộ nhớ và chống brute-force**

| Loại | Giới hạn |
| --- | --- |
| Account | 1.000 |
| Session Admin | 5.000; TTL 60 phút |
| Context CSRF trước login | 5.000; TTL 10 phút |
| Bucket login | 2.048 key; cửa sổ 15 phút |
| Login theo socket IP | 20 lần / 15 phút |
| Login theo username chuẩn hóa | 5 lần / 15 phút; thành công xóa bucket username |
| Login đang kiểm tra mật khẩu | 8 request đồng thời; vượt ngưỡng trả 429, không tạo queue vô hạn |

Bucket chỉ giữ hash của IP/username. Không dùng `X-Forwarded-For` làm danh tính limiter. Entry hết hạn được thu hồi; đầy bộ nhớ thì từ chối, không evict bucket đang hiệu lực để mở lại hạn mức. Account/session/context quá dung lượng trả 503, login limit trả 429 + Retry-After. Giới hạn nằm trong `src/config/auth.js`.

**API auth và accounts**

| Method / API | Đầu vào / kết quả |
| --- | --- |
| `GET /api/auth/csrf` | Trả `{csrfToken}`; set context cookie nếu cần |
| `POST /api/auth/login` | JSON `{username,password}`, cookie context + `X-CSRF-Token`; set cookie session, trả user an toàn, csrfToken, expiresAt, serverTime |
| `GET /api/auth/me` | Cookie session; trả user an toàn, csrfToken và thời gian phiên |
| `POST /api/auth/logout` | Cookie + CSRF, JSON `{}`; 204 và clear cookie |
| `GET /api/accounts` | Danh sách user an toàn, chỉ ADMIN |
| `POST /api/accounts` | JSON `{username,password,role}`, chỉ ADMIN |
| `PATCH /api/accounts/:id` | JSON `{role}` và/hoặc `{isLocked:boolean}`, chỉ ADMIN |
| `POST /api/accounts/:id/password` | JSON `{password}`, chỉ ADMIN |

Chỉ hai role ADMIN và POI_MANAGER. ADMIN quản lý cả accounts/voucher/nội dung; POI_MANAGER quản lý mọi POI, dịch và audio, không có quyền accounts/voucher. Không thêm endpoint xóa tài khoản. Không thể khóa hoặc bỏ quyền ADMIN hoạt động cuối cùng; ADMIN đã khóa không được tính là người thay thế. Kiểm tra và cập nhật nằm trong một đoạn repository đồng bộ; test hai request hạ quyền đồng thời vẫn giữ ít nhất một ADMIN hoạt động.

**Chạy PowerShell và cấu hình .env**

Chạy tại thư mục `be-demo`. `npm start` đọc `.env` bằng dotenv; biến môi trường đã có được ưu tiên. Không ghi đè `.env` hiện tại nếu đang chứa cấu hình dịch/Piper. Bổ sung username/password bootstrap của chính bạn và origin:

```dotenv
# Các giá trị trống dưới đây là placeholder; phải điền cục bộ trước khi chạy.
ADMIN_BOOTSTRAP_USERNAME=
ADMIN_BOOTSTRAP_PASSWORD=
ADMIN_ORIGIN=http://localhost:3000
# Origin cho QR, tùy chọn khi demo local; không kèm path/query.
PUBLIC_ORIGIN=
```

Nếu password chứa `#`, đặt giá trị trong dấu nháy theo cú pháp dotenv. `.env` đang được Git ignore. `.env.example` chỉ có giá trị trống và hướng dẫn an toàn. Không có mật khẩu mặc định.

```powershell
Set-Location 'D:\SUBJECTS FOR IT\CNPM\be-demo-3layer-cicd\be-demo'
npm.cmd ci
npm.cmd start
```

Hoặc cấp mật khẩu cho lần chạy hiện tại qua prompt, không đặt literal mật khẩu vào lịch sử shell:

```powershell
$env:ADMIN_BOOTSTRAP_USERNAME = 'your_admin_name'
$env:ADMIN_ORIGIN = 'http://localhost:3000'
$bootstrapSecret = Read-Host 'Mat khau bootstrap (12+ ky tu, toi da 72 byte UTF-8)' -AsSecureString
$env:ADMIN_BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $bootstrapSecret).Password
try { npm.cmd start }
finally {
    Remove-Item Env:ADMIN_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
    $bootstrapSecret.Dispose()
}
```

Server hash/bootstrap trước khi listen; cấu hình thiếu/không hợp lệ làm process thất bại với thông báo không chứa secret. Test import `app` không đọc `.env` hay tự bootstrap: fixture riêng seed account và đăng nhập qua HTTP thật. Production cần `NODE_ENV=production`, `ADMIN_ORIGIN=https://<origin-thuc-te>` và HTTPS tại endpoint trình duyệt truy cập. `PUBLIC_ORIGIN` có thể dùng cùng origin HTTPS để điện thoại mở QR. Giữ origin thống nhất: localhost và 127.0.0.1 là hai origin/cookie host khác nhau. [dotenv](https://github.com/motdotla/dotenv).

**Kiểm thử và CI**

Baseline: 16 suites / 546 tests; ESLint 0 errors, 2 warnings cũ; Git sạch. Sau triển khai: `npm.cmd test` pass 19 suites / 657 tests (111 test mới). ESLint 0 errors / 2 warnings cũ. `git diff --check` pass. Không đưa WAV/secret vào Git.

Test mới: `auth.test.js`, `accounts.security.test.js`, `frontend.auth.test.js`. Bao phủ login đúng/sai, khóa, cookie flags, hết hạn, logout/replay, session rotation, CSRF login/logout/mutation, Origin, brute-force, bounded memory/work, RBAC từng route, mass assignment, reset password, last ADMIN, cạnh tranh cập nhật, startup và vòng đời frontend. Fake clock cho hết hạn; provider dịch/Piper được mock. Fixture hồi quy đăng nhập thật qua CSRF/password, không có production auth bypass. Test Stage 8 tiếp tục kiểm tra redeem một lần/đồng thời, GPS, narration, WAV/HEAD/Range/traversal và alias static.

Workflow Node 18/20 không thay đổi, không thêm yêu cầu Docker, mạng provider, database, model, `.env` local hay mật khẩu thật vào bước test. Dockerfile đã copy thêm Admin HTML và login HTML; không bake bootstrap secret hoặc WAV vào image. Chưa chạy Docker build hay kiểm tra trình duyệt thật trong phiên này; người dùng sẽ tự thực hiện checklist dưới đây.

**File mới**

- `src/config/auth.js`
- `src/controllers/auth.controller.js`, `src/controllers/account.controller.js`
- `src/services/auth.service.js`, `src/services/account.service.js`
- `src/repositories/auth.repository.js`, `src/repositories/account.repository.js`
- `src/routes/auth.routes.js`, `src/routes/account.routes.js`
- `src/middlewares/requireAdmin.js`, `src/middlewares/csrf.js`
- `src/utils/auth.js`, `src/utils/authHttp.js`
- `public/admin-login.html`, `public/js/admin-login.js`, `public/js/admin-auth.js`, `public/js/accounts.js`
- `tests/auth.test.js`, `tests/accounts.security.test.js`, `tests/frontend.auth.test.js`
- `tests/helpers/auth-session.js`, `tests/helpers/auth-request.js`
- `STAGE9-REPORT.md`

**File sửa/xóa**

- `.env.example`, `package.json`, `package-lock.json`, `Dockerfile`
- `src/app.js`, `src/server.js`
- `src/controllers/poi.controller.js`, `src/controllers/audio.controller.js`
- `src/routes/poi.routes.js`, `src/routes/access.routes.js`, `src/routes/narration.routes.js`, `src/routes/job.routes.js`
- `src/middlewares/requireAccess.js`, `src/middlewares/demoAdmin.js`, `src/middlewares/errorHandler.js`
- `public/admin.html`, `public/css/admin.css`, `public/js/admin.js`, `public/js/vouchers.js`
- `tests/access.test.js`, `tests/access.security.test.js`, `tests/frontend.admin.test.js`, `tests/frontend.vouchers.test.js`, `tests/job.test.js`, `tests/narration.test.js`, `tests/poi.audio.test.js`, `tests/poi.narrations.test.js`, `tests/poi.nearby.test.js`, `tests/poi.test.js`, `tests/webapp.test.js`
- Xóa `tests/helpers/demo-request.js`, thay bằng fixture auth thật.

**Giới hạn bảo mật và vận hành**

Account, session, role, khóa/reset mật khẩu và limiter đều in-memory, chỉ nhất quán trong một process. Restart mất mọi thay đổi tài khoản và tạo lại ADMIN từ cấu hình bootstrap; password reset trong UI không thay password bootstrap ở `.env`. Stage 10 cần lưu bền vững và transaction cho last ADMIN, session/revocation và limiter dùng chung giữa instance.

Cookie HttpOnly không loại trừ XSS thực thi request cùng origin; frontend dùng textContent cho dữ liệu. HTTPS cần được triển khai thực tế. Limiter dùng socket IP nên nhiều người sau cùng reverse proxy có thể chung hạn mức; cần limiter ở proxy tin cậy trước khi mở rộng triển khai, không bật trust proxy tùy tiện để tin header client.

Một số thao tác đã được chấp nhận trước logout có thể hoàn thành khi đang chạy; account mutation recheck actor sau hash và audio recheck session sau filesystem lookup. Byte audio đã gửi/tải xuống không thu hồi tuyệt đối được. Session hết hạn được backend từ chối ở yêu cầu tiếp theo; timer frontend giúp dừng player nhưng chịu lịch chạy của trình duyệt. Không triển khai MFA, recovery qua email hoặc persistence trong stage này.

**Checklist demo trình duyệt**

1. Thiếu bootstrap password → server dừng trước khi listen. Điền cấu hình hợp lệ → `npm.cmd start` chạy; log không chứa mật khẩu.
2. Cửa sổ private mở `/admin.html` → chuyển login. Tourist `/` và POI/GPS vẫn mở không login.
3. Login sai username/password → cùng thông báo. Login đúng → hiện username/ADMIN và nút Đăng xuất; refresh vẫn nhận diện phiên từ cookie.
4. DevTools Application kiểm tra cookie HttpOnly, Strict, Path=/; HTTPS/production có Secure. Không có token Admin trong localStorage/sessionStorage. Cookie được trình duyệt quản lý, không đọc qua `document.cookie`.
5. ADMIN tạo POI, lưu VI, dịch EN/JA/KO, tạo và nghe thử audio từng ngôn ngữ; thử seek/Range ở player. Provider thật cần cấu hình cục bộ như các stage trước.
6. ADMIN tạo vé 60 phút → QR/URL → Tourist kích hoạt không login → GPS giả lập ngoài/trong → nghe tự động, đổi ngôn ngữ, ra/vào lại. WAV trực tiếp thiếu Bearer bị 401.
7. Tạo POI_MANAGER, đăng nhập bằng cửa sổ private khác: quản lý nội dung/audio được, không thấy voucher/accounts. Gọi API voucher/accounts bằng session manager vẫn bị 403.
8. Khóa manager trong cửa sổ ADMIN; request kế tiếp của manager bị 401, login bị từ chối. Mở khóa → login mới được. Đổi role/reset password thu hồi session cũ; password cũ không còn login được sau reset.
9. Thử khóa/hạ quyền ADMIN hoạt động cuối cùng → 409. Tạo ADMIN thứ hai trước thì được chuyển quyền/khóa một tài khoản; không thể làm cả hai mất quyền hoạt động.
10. Xóa/sửa `X-CSRF-Token` trong request mutation, login hoặc logout → 403, dữ liệu/session không bị thay đổi. Request cross-origin với token đúng cũng bị từ chối.
11. Đăng xuất → quay lại login; replay cookie cũ bị 401. Nếu logout mất mạng, giao diện báo phiên server có thể còn hiệu lực và cho thử lại.
12. Admin session hết hạn tuyệt đối sau 60 phút → request tiếp bị 401 và giao diện về login. Các test fake clock đã kiểm tra ranh giới hết hạn; không cần chờ thời gian thật khi chạy Jest.
13. Brute-force liên tục → 429 + Retry-After; hết cửa sổ 15 phút có thể thử lại. Không dùng tài khoản bootstrap thật để chia sẻ log hay báo cáo test.

Chưa commit, chưa push.
