# NHẬT KÝ PHÁT TRIỂN DỰ ÁN -- THIENPHU1208

**Môn học:** Công nghệ phần mềm (CNPM)\
**Dự án:** Hệ thống thuyết minh tự động theo vị trí GPS (Auto Narration)\
**GitHub:** [CNPM_Nhom4_DCT124C6](https://github.com/nyn06/CNPM_Nhom4_DCT124C6)\
**Tài khoản Git:** `ThienPhu1208` (tên tác giả trước đây: `ThienPhu`)\
**Thời gian theo dõi:** 19/10/2026 -- 26/11/2026

## 1. Mục đích

Tài liệu tổng hợp quá trình thực hiện công việc cá nhân theo từng tuần, dựa trên lịch sử commit của tác giả `ThienPhu` và `ThienPhu1208` cùng các công việc phân tích, chuẩn bị môi trường và kiểm thử đã ghi nhận.

## 2. Báo cáo tiến độ theo tuần

  --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  Tuần                    Thời gian               Công việc thực hiện
  ----------------------- ----------------------- --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  7                       19--25/10/2026          Nghiên cứu mã nguồn, cấu trúc Backend, API POI và giao diện quản trị; phân tích Use Case và xây dựng biểu đồ hoạt động cho các chức năng tra cứu POI, bản đồ, chuyển đổi ngôn ngữ và nghe thuyết minh. Chưa có commit cá nhân được tìm thấy.

  8                       26/10--01/11/2026       Chưa có thông tin công việc cá nhân được xác nhận.

  9                       02--08/11/2026          Chưa có thông tin công việc cá nhân được xác nhận.

  10                      09--15/11/2026          Cài đặt WSL 2, Docker Desktop, triển khai SQL Server trên Docker, chuẩn bị kết nối cơ sở dữ liệu; phát triển chức năng tải ảnh POI và hiển thị ảnh trên giao diện Admin, bản đồ và thẻ địa điểm.

  11                      16--22/11/2026          Hoàn thiện bản dịch QR voucher và nút tiếp tục; phát triển cơ chế tự động tải ảnh khi tạo POI; cải thiện bản dịch Admin và quy trình tải ảnh.

  12                      23--26/11/2026          Hoàn thiện thao tác xác nhận ảnh trước khi tạo POI, kiểm tra định dạng JPEG/PNG/WebP và giới hạn 5 MB; bổ sung thông báo đa ngôn ngữ và cập nhật tức thì khi chuyển ngôn ngữ; kiểm tra cú pháp, kiểm thử giao diện và push nhánh chức năng lên GitHub.
  --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## 3. Hình ảnh minh chứng quá trình phát triển

Chưa đính kèm hình ảnh minh chứng. Có thể bổ sung ảnh môi trường Docker/SQL Server, giao diện tải ảnh POI, giao diện QR voucher đa ngôn ngữ và kết quả kiểm thử chuyển đổi ngôn ngữ. Các liên kết commit tại mục 4 là minh chứng mã nguồn hiện có.

## 4. Các commit tiêu biểu

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------
  Ngày                    Commit                                                                     Nội dung
  ----------------------- -------------------------------------------------------------------------- ----------------------------------------------------------------
  13/11/2026              [`b201fe5`](https://github.com/nyn06/CNPM_Nhom4_DCT124C6/commit/b201fe5)   Tải ảnh POI và hiển thị ảnh trên Admin, bản đồ và thẻ địa điểm

  17/11/2026              [`9870558`](https://github.com/nyn06/CNPM_Nhom4_DCT124C6/commit/9870558)   Hoàn thiện bản dịch QR voucher trong Admin

  17/11/2026              [`6c79518`](https://github.com/nyn06/CNPM_Nhom4_DCT124C6/commit/6c79518)   Dịch nút tiếp tục của voucher

  18/11/2026              [`1f4ca70`](https://github.com/nyn06/CNPM_Nhom4_DCT124C6/commit/1f4ca70)   Tự động tải ảnh khi tạo địa điểm mới

  18/11/2026              [`d8ce52b`](https://github.com/nyn06/CNPM_Nhom4_DCT124C6/commit/d8ce52b)   Cải thiện bản dịch Admin và tải ảnh POI

  23/11/2026              [`24ed8dd`](https://github.com/nyn06/CNPM_Nhom4_DCT124C6/commit/24ed8dd)   Hoàn thiện tải ảnh POI và thông báo đa ngôn ngữ
  -------------------------------------------------------------------------------------------------------------------------------------------------------------------

## 5. Ghi chú về lịch sử phát triển

-   Thống kê 6 commit tìm thấy bằng lệnh `git log --all --author="ThienPhu"` trên các nhánh hiện có.
-   Ngày commit lấy từ lịch sử Git; không nhất thiết trùng ngày thực hiện hoặc push mã nguồn.
-   Công việc phân tích, tài liệu và chuẩn bị môi trường được ghi nhận riêng, không được tính thành commit.
-   Không có commit không đồng nghĩa với không thực hiện công việc.
-   Commit `24ed8dd` đã được push lên nhánh `feature/fix-add-poi-image-upload`; trạng thái tích hợp vào `main` chưa được xác nhận.

## 6. Kết luận

Quá trình thực hiện tập trung vào phân tích hệ thống, chuẩn bị môi trường phát triển, chức năng hình ảnh POI và hoàn thiện trải nghiệm đa ngôn ngữ trong giao diện quản trị. Các thay đổi được quản lý bằng Git, kiểm tra cú pháp và kiểm thử giao diện trước khi chuyển giao để tích hợp vào hệ thống chung.
