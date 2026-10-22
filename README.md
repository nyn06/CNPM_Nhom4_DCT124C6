# CNPM_Nhom4_DCT124C6

## Mã kích hoạt vé QR

Đặt `ACTIVATION_CODE_SECRET` trong `.env` thành một giá trị ngẫu nhiên riêng tư, ổn định, dài ít nhất 32 ký tự (ví dụ sinh 32 byte bằng `crypto.randomBytes(32).toString('hex')`). Giữ cùng giá trị trên mọi instance; đổi khóa sẽ khiến mã ngắn của vé chưa dùng không tra cứu được. Không đưa khóa vào Git.

Chạy `npm run db:migrate` để thêm cột băm mã ngắn vào bảng `Vouchers`, rồi khởi động lại server. Vé cũ vẫn kích hoạt bằng QR hoặc token như trước. Khi tạo vé mới, Admin chỉ thấy mã 7 ký tự trong phản hồi tạo vé; API danh sách không trả mã này.
