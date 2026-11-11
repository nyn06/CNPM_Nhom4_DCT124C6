# CNPM_Nhom4_DCT124C6

## Demo vé QR: du khách chọn thời gian

Migration `007_voucher_purchases.sql` cho phép voucher mới chưa có thời hạn và tạo bảng
`VoucherPayments`. Các voucher cũ vẫn giữ `DurationMinutes` 15/60/120 và tiếp tục dùng
`POST /api/access/redeem`; dữ liệu cũ không được chuyển đổi. Chạy migration trên database
đã được sao lưu theo quy trình của dự án trước khi khởi động phiên bản này.

Để demo trên máy phát triển, đặt `NODE_ENV=development` và `DEMO_PAYMENT_ENABLED=true`
trong môi trường server. Chế độ này luôn bị khóa khi `NODE_ENV=production`. Giá mặc định
là 15 phút/15.000 ₫, 30 phút/30.000 ₫, 60 phút/60.000 ₫; có thể đặt
`TOUR_PRICE_15`, `TOUR_PRICE_30`, `TOUR_PRICE_60` thành số nguyên VNĐ dương.
Đây là xác nhận thanh toán **mô phỏng**, không thu tiền thật.

1. Admin đăng nhập và tạo QR ở mục Quản lý vé QR. QR mới chưa gắn gói.
2. Du khách quét QR, mở WebApp và chọn 15/30/60 phút. WebApp gọi
   `/api/access/inspect`, rồi `/api/access/choose`; backend quyết định giá.
3. Bấm **Thanh toán mô phỏng**. Transaction chuyển sang `paid`, đồng hồ chưa chạy.
4. Bấm **Bắt đầu tham quan**. `/api/access/start` tạo đúng một `GuestSession`, tính
   hạn từ thời điểm này và bật luồng GPS, geofence, audio hiện có.
5. Khi reload link QR, backend trả lại trạng thái giao dịch; session đã bắt đầu được
   khôi phục bằng access token trong tab đã kích hoạt.

`POST /api/access/redeem` từ chối voucher mới chưa thanh toán. Bảng vé Admin hiển thị
gói, giá chốt lúc chọn và trạng thái giao dịch; lịch sử kích hoạt cũ vẫn dựa trên
`GuestSessions`. Bảng `VoucherPayments` có một giao dịch cho mỗi voucher, và transaction
SQL Server khóa voucher khi chọn gói, thanh toán mô phỏng hoặc bắt đầu phiên.

## Mã kích hoạt vé QR

Đặt `ACTIVATION_CODE_SECRET` trong `.env` thành một giá trị ngẫu nhiên riêng tư, ổn định, dài ít nhất 32 ký tự (ví dụ sinh 32 byte bằng `crypto.randomBytes(32).toString('hex')`). Giữ cùng giá trị trên mọi instance; đổi khóa sẽ khiến mã ngắn của vé chưa dùng không tra cứu được. Không đưa khóa vào Git.

Chạy `npm run db:migrate` để thêm cột băm mã ngắn vào bảng `Vouchers`, rồi khởi động lại server. Vé cũ vẫn kích hoạt bằng QR hoặc token như trước. Khi tạo vé mới, Admin chỉ thấy mã 7 ký tự trong phản hồi tạo vé; API danh sách không trả mã này.

## API và migration Legacy

Các API độc lập `/api/narrations` và `/api/jobs` đã ngừng hoạt động. Thuyết minh đang dùng các API `/api/pois/:id/narrations/...`; hàng đợi dịch POI dùng `POITranslationJobs`. `GET /api/languages` vẫn trả danh sách `vi`, `en`, `ja`, `ko`, `fr`, `zh`.

Migration `006_remove_legacy_narrations_jobs.sql` chỉ xóa `dbo.Narrations` và `dbo.Jobs`. Trước khi chạy trên một database đang dùng, tạo backup đầy đủ và xác minh bằng `RESTORE VERIFYONLY ... WITH CHECKSUM`. Migration tự dừng nếu hai bảng còn dữ liệu hoặc có khóa ngoại/module SQL phụ thuộc. Runner chạy migration trong transaction nên lỗi trước commit sẽ rollback. Nếu cần khôi phục sau khi migration đã thành công, dừng ứng dụng, xác minh file backup, rồi restore toàn bộ database từ file đó trong SQL Server theo quy trình vận hành; việc restore sẽ đưa cả dữ liệu phát sinh sau thời điểm backup về trạng thái cũ.

## Tài nguyên dịch vụ dịch trên máy phát triển

Khi tạo lại container LibreTranslate, dùng `compose.translation.yml` với `LT_LOAD_ONLY=vi,en,ja,ko` và `LT_THREADS=2`. Mỗi worker Gunicorn nạp mô hình dịch riêng; bốn worker đã dùng gần 6 GiB trong Docker có 7,58 GiB RAM, khiến SQL Server báo lỗi 701 và khởi động lại. Kiểm tra số worker bằng `docker top libretranslate`, sau đó kiểm tra `http://localhost:5000/languages` và `http://localhost:3000/health`. Container hiện tại đã được cấu hình hai worker và giữ cấu hình qua `docker restart`; trước khi tạo container mới từ Compose, dừng và đổi tên container `libretranslate` hiện tại để tránh trùng tên và cổng.
