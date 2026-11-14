# Instagram Auto Poster — Chrome extension

Tự đăng ảnh lên Instagram theo lịch. Mỗi bài, công cụ:

- bốc ngẫu nhiên ảnh trong một thư mục trên máy bạn,
- kèm một **câu khen ngẫu nhiên**: lấy từ kho 20.000 câu khen LenaMiu có sẵn (cùng kho với bot X), hoặc từ câu bạn tự viết,
- **tag người lên ảnh**,

rồi bấm Chia sẻ.

Công cụ còn **comment khen vào bài khác**: bạn dán list link bài, công cụ vào từng bài và comment một câu khen ngẫu nhiên.

Công cụ chạy ngay trong tab instagram.com bạn đã đăng nhập, không cần API key hay mật khẩu.

## Cài

Dùng được trên **Windows và Mac**, với **Chrome**. Các trình duyệt cùng nhân với Chrome như Edge, Brave, Cốc Cốc cũng được, chỉ khác chỗ gõ địa chỉ: `edge://extensions`, `brave://extensions`... Không dùng được trên Safari, Firefox hay điện thoại. Các bước cài trên Mac giống hệt Windows.

1. Tải về: vào **https://github.com/dangtthuynhi/instagram-post**, bấm **`< > Code`** → **Download ZIP**. Giải nén vào một thư mục cố định, ví dụ trong **Tài liệu**. Đừng để trong **Tải xuống**: Chrome đọc trực tiếp từ thư mục này, lỡ xoá là công cụ ngừng chạy.
2. Gõ `chrome://extensions` vào thanh địa chỉ, bật **Chế độ dành cho nhà phát triển** (góc trên bên phải).
3. Bấm **Tải tiện ích đã giải nén**, chọn thư mục **`extension`**. Bên trong thư mục đó phải có `content.js`, `content-lenamiu.json`, `manifest.json`, `unload-guard.js`.
4. Mở **instagram.com** và đăng nhập. Bảng điều khiển hiện ở góc dưới bên phải; không thấy thì nhấn **F5**.

## Dùng

### 1. Ảnh

1. Bấm **Chọn thư mục ảnh** rồi chọn thư mục chứa ảnh.
2. Chrome hỏi *"Tải N tệp lên trang web này?"*: bấm **Tải lên**. Ảnh không bị gửi đi đâu. Extension chỉ chép ảnh vào bộ nhớ của Chrome trên máy bạn, để lần sau khỏi phải chọn lại.

Cách công cụ lấy ảnh:

- Nhận ảnh jpg, png, heic. Ảnh webp, avif, gif được tự đổi sang jpg. Ảnh trong thư mục con cũng được lấy.
- Thêm hay xoá ảnh trong thư mục thì bấm **Chọn thư mục ảnh** lại.

Các ô cài đặt:

- **Mỗi bài … đến … ảnh**: để `1` đến `1` là mỗi bài một ảnh. Để `1` đến `3` là mỗi bài ngẫu nhiên từ 1 đến 3 ảnh (bài nhiều ảnh, tối đa 20 ảnh).
- **dùng hết ảnh thì đăng lại ảnh cũ** (bật sẵn): công cụ dùng ảnh chưa đăng trước, hết thì đăng lại ảnh cũ. Bỏ chọn ô này nếu muốn hết ảnh thì dừng.
- **giữ tỉ lệ ảnh gốc** (bật sẵn): ảnh không bị cắt vuông.

### 2. Câu khen (caption)

- **Nguồn**:
  - **Kho có sẵn** (mặc định): 20.000 câu khen LenaMiu.
  - **Câu của mình**: câu bạn dán vào ô. Các câu cách nhau bằng một dòng trống. Câu nào có dòng trống bên trong thì tách các câu bằng một dòng `---`.
  - **Cả hai**: bốc từ cả hai nguồn.
- Mỗi bài bốc ngẫu nhiên **một câu chưa dùng**, dùng hết mới quay vòng. Vì vậy ảnh có đăng lại thì câu khen vẫn khác.
- Ô **Thêm vào cuối mỗi caption** dùng cho phần chung của mọi bài, ví dụ `#LenaMiu #ลีน่าหมิว` hoặc `@tên`.

Dưới ô có dòng đếm, ví dụ `Kho 20000 cau, da dung 12`.

### 3. Tag người trên ảnh

Gõ tên tài khoản cần tag, cách nhau bằng dấu cách hoặc xuống dòng. Có `@` hay không đều được. Tối đa 20 người.

- Đây là **tag trên ảnh**, giống như bạn bấm vào ảnh rồi chọn người. Người được tag nhận thông báo, và bài hiện trong mục **"Được gắn thẻ"** của họ.
- Muốn nhắc tên trong caption nữa thì gõ `@tên` vào ô **Thêm vào cuối mỗi caption**.
- Bài nhiều ảnh thì tag lên **ảnh đầu tiên**.
- Mỗi người được tag ở **một chỗ ngẫu nhiên** trên ảnh, tránh mép ảnh. Người sau không đè lên tag của người trước: công cụ giữ khoảng cách với các chỗ đã tag, và đo cả nhãn tên đang hiện trên ảnh.
- Công cụ chọn dòng kết quả đúng tên. Không có dòng nào đúng tên (ví dụ tài khoản tick xanh, tên có chữ đặc biệt) thì công cụ **lấy kết quả đầu tiên** và ghi vào nhật ký đã chọn dòng nào.
- Mỗi người được thử **2 lần**. Lần thứ hai công cụ bấm vào chỗ khác trên ảnh và gõ chậm hơn.
- Thử 2 lần vẫn không tag được (gõ sai tên, hoặc người đó không cho người khác tag) thì công cụ bỏ qua tên đó, ghi vào nhật ký, và bài vẫn được đăng.

### 4. Comment khen vào bài khác

1. Dán link các bài cần comment vào ô **Comment khen vào bài khác**, mỗi dòng một link:

   ```
   https://www.instagram.com/p/ABC123xyz/
   https://www.instagram.com/reel/DEF456uvw/
   ```

   Lấy link: mở bài trên Instagram, bấm **…** → **Sao chép liên kết**, hoặc copy từ thanh địa chỉ. Link dạng `/p/`, `/reel/` hay `/tên/p/` đều được. Phần đuôi `?igsh=…` không sao.
2. **Mỗi bài comment … lần**: mỗi lần là một câu khen khác nhau.
3. **Thêm vào cuối mỗi comment**: hashtag hoặc `@tên`, dùng chung cho mọi comment. Ô này tách riêng với phần cuối của caption.
4. Chỉnh nhịp: **comment cách nhau … phút** (mặc định 5–15) và **tối đa … comment/ngày** (mặc định 20).

Cách công cụ comment:

- Câu khen lấy cùng **Nguồn** với caption và không lặp với câu đã dùng (kể cả câu đã dùng làm caption).
- Công cụ làm list từ trên xuống. Mỗi bài comment đủ số lần rồi mới sang bài sau. Lúc mở bài, trang sẽ tải lại: không sao, công cụ làm tiếp.
- **Bài đã comment đủ thì không comment lại**, kể cả khi bạn dán lại link đó. Muốn comment thêm thì tăng số lần, công cụ chỉ làm phần còn thiếu.
- Bài **tắt bình luận** hoặc **không còn** thì bỏ qua và ghi vào nhật ký.
- Chỉ muốn comment, không đăng ảnh: bỏ chọn **Đăng bài ảnh mới** ở đầu bảng. Comment xong list thì công cụ tự dừng.
- Có cả đăng ảnh lẫn comment thì hai việc chạy xen nhau, mỗi việc theo nhịp riêng. Đến giờ cùng lúc thì comment trước.

Dưới ô list có dòng đếm, ví dụ `3 bai × 1 lan · xong 1/3 · ke tiep: bai 2`. Dòng nào không phải link bài sẽ được báo đỏ và bỏ qua.

### 5. Chạy

1. Ở phần **Chung**, chọn **chỉ chạy từ … đến … giờ**. Khung giờ này áp dụng cho cả đăng ảnh lẫn comment.
2. Lần đầu, chạy thử từng việc:
   - **Đăng thử 1 bài**: bài này đăng thật. Ngồi xem công cụ làm từng bước, rồi mở trang cá nhân kiểm tra ảnh, caption và tag.
   - **Comment thử 1 lần**: comment thật vào bài đầu tiên trong list còn chưa comment.
3. Ổn rồi thì bấm **Bắt đầu** và để yên tab đó.

## Cần biết

- **Ẩn tab vẫn chạy.** Bạn có thể chuyển sang tab khác hoặc thu nhỏ cửa sổ, chỉ cần không đóng tab Instagram và không để máy ngủ.
  - Chrome làm chậm tab ẩn, trừ tab đang phát âm thanh. Vì vậy lúc chạy, công cụ phát một âm cực nhỏ mà tai không nghe được, và tab Instagram sẽ hiện **icon loa**. Đó là âm của công cụ, đừng tắt tiếng tab.
  - Chrome chỉ cho bật âm sau một lần bấm trên trang. Bấm **Bắt đầu** là đủ. Khi trang tải lại (ví dụ lúc mở bài để comment), nếu bảng điều khiển báo *"Che do chay nen chua bat"* thì bấm vào trang Instagram một lần.
  - Tab hiện trên màn hình vẫn là cách chạy nhanh và chắc nhất.
- Mở cửa sổ đủ rộng để thấy thanh bên trái có nút **Tạo**.
- **Đừng đụng chuột vào tab lúc đang đăng.** Mỗi bài mất khoảng một phút, lâu hơn nếu tag nhiều người.
- Mặc định 5 bài ảnh/ngày (cách nhau 60–180 phút) và 20 comment/ngày (cách nhau 5–15 phút), chỉ chạy từ 8 đến 23 giờ. Instagram bắt bot gắt hơn X: đăng dày, comment dồn dập, hoặc tag cùng một nhóm người liên tục, dễ bị chặn ("Action blocked") hoặc bị bắt xác minh tài khoản.
- **Instagram hiện hộp "Thử lại sau / We restrict certain activity"** thì công cụ **dừng hẳn**. Để tài khoản nghỉ vài giờ đến một ngày, rồi chạy lại với nhịp chậm hơn.
- Instagram cho tối đa 2.200 ký tự và 30 hashtag mỗi caption. Câu nào vượt sẽ báo đỏ dưới ô, và công cụ không đăng câu đó.
- **Khi đăng lỗi**, công cụ thử lại sau 5 phút, rồi 10 phút. Lỗi 3 lần liên tiếp thì dừng.
- **Khi không rõ bài đã lên chưa** (đã bấm Chia sẻ nhưng không thấy báo kết quả), ảnh và câu khen của bài đó được coi là đã dùng, để không đăng trùng. Mở trang cá nhân xem cho chắc.
- Xoá dữ liệu duyệt web của instagram.com thì phải chọn lại thư mục ảnh.
- File `extension/content-lenamiu.json` là bản chép từ bot X (`twitter-tweet/chrome-extension/content-lenamiu.json`). Sửa kho bên đó thì chép đè file này, rồi bấm Reload extension.

## Khi gặp trục trặc

Instagram không gắn mã cố định cho các nút, nên công cụ tìm nút theo chữ và nhãn hiển thị (tiếng Anh, Việt, Thái). Instagram đổi giao diện thì công cụ có thể không tìm thấy nút nữa.

Bấm **Kiểm tra trang**. Khung nhật ký sẽ ghi ra công cụ có thấy những thứ sau hay không:

- nút Tạo,
- ô chọn ảnh, nút chọn tỉ lệ, nút Tiếp,
- ô caption, nút Chia sẻ, khung ảnh để tag.

Kèm theo là hai dòng **"Nút trong hộp"** và **"Icon trên trang"**, ghi tên thật của các nút trên trang.

Để kiểm tra đủ các bước: tự bấm **Tạo → Bài viết**, chọn một ảnh, rồi bấm **Kiểm tra trang** ở từng bước (cắt ảnh, bộ lọc, viết caption). Gửi lại các dòng nhật ký đó để sửa.

Phần comment: mở một bài bất kỳ, rồi bấm **Kiểm tra trang**. Nhật ký ghi công cụ có thấy ô bình luận và nút Đăng hay không.

**Tag không được.** Nhật ký ghi từng người: `Da tag @ten.`, hoặc dòng báo lỗi của từng lần thử:

- `Tag @ten (lan 1): bam vao anh nhung o tim nguoi khong mo.`: Instagram không mở ô tìm người.
- `Tag @ten (lan 1): khong tim thay. O tim dang co "...", ket qua dang hien: ...`: công cụ đã gõ gì vào ô tìm, và Instagram hiện ra kết quả nào.

Gửi lại các dòng đó để sửa.

Nhật ký chi tiết cũng có trong DevTools (F12 → Console), tìm các dòng bắt đầu bằng `[ig-poster]`.

## Sửa code

Sửa thẳng `extension/content.js` (bản này không có bước build). Sau đó vào `chrome://extensions` bấm **Reload** (↻) và tải lại tab Instagram.

Test phần bốc ảnh, câu khen, tag và hẹn giờ (cần Node 20+, không phải cài thêm gì):

```bash
npm test
```

---

Làm bởi **dangtthuynhi** — https://github.com/dangtthuynhi/instagram-post
