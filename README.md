# Chess Move % — tiện ích hiện % nước đi trên Chess.com

Tiện ích Chrome (Manifest V3) hiển thị **tần suất từng nước đi** và **tỉ lệ
thắng / hòa / thua** cho đúng thế cờ đang mở trên Chess.com — ngay trên bàn cờ
và trong một bảng nhỏ có thể kéo thả.

Dữ liệu lấy từ [Lichess opening explorer](https://lichess.org/analysis) (miễn
phí, không cần tài khoản hay API key):

* **Ván của người chơi Lichess** — lọc được theo thể loại (bullet → classical)
  và mức Elo.
* **Ván của kiện tướng (OTB)** — cơ sở dữ liệu cờ bàn trình độ 2200+.

## Tính năng

| | |
|---|---|
| **% trên bàn cờ** | Huy hiệu phần trăm đặt ngay ô đích của các nước phổ biến nhất |
| **Bảng thống kê** | Tần suất, tỉ lệ thắng/hòa/thua, số ván, Elo trung bình cho từng nước |
| **Tên khai cuộc** | Mã ECO + tên khai cuộc của thế cờ hiện tại |
| **Mũi tên gợi ý** | Rê chuột lên một dòng để thấy nước đi đó trên bàn cờ |
| **Theo dõi mọi chế độ** | Ván trực tiếp, phân tích, xem lại ván, bàn cờ lật ngược |
| **Bộ lọc** | Thể loại và mức Elo đổi trực tiếp trong bảng hoặc ở trang tùy chọn |

Tiện ích chỉ **đọc** thế cờ từ giao diện; nó không gửi nước đi, không can thiệp
vào ván đấu và không đọc tài khoản của bạn.

> ⚠️ **Lưu ý fair play:** Chess.com cấm dùng trợ giúp ngoài trong **ván đang
> chơi**. Tiện ích này tra cứu thống kê khai cuộc, tức là trợ giúp ngoài. Hãy
> dùng nó để **ôn khai cuộc và phân tích ván đã đấu**, và tắt đi (Alt+P hoặc
> tắt hẳn trong trang tùy chọn) khi đang thi đấu.

## Cài đặt

Tiện ích chưa có trên Chrome Web Store, cài thủ công như sau:

1. Tải mã nguồn: `git clone https://github.com/nhutqui23091/chessQ.git`
2. Mở `chrome://extensions` trong Chrome / Edge / Brave.
3. Bật **Developer mode** (góc trên bên phải).
4. Bấm **Load unpacked** và chọn thư mục vừa tải về.
5. Mở một ván cờ trên chess.com — bảng thống kê hiện ở góc dưới bên phải.

Không cần bước build: `src/vendor/chess.bundle.js` đã được đóng gói sẵn trong
repo.

## Sử dụng

* **Alt+P** hoặc bấm biểu tượng tiện ích: ẩn/hiện bảng.
* Kéo thanh tiêu đề để di chuyển bảng (vị trí được ghi nhớ).
* **⚙** trong bảng: đổi thể loại / mức Elo / bật tắt % trên bàn cờ.
* **–** thu gọn bảng, **×** ẩn bảng.
* Ô chọn ở thanh tiêu đề: đổi giữa dữ liệu người chơi Lichess và kiện tướng.

Khi thế cờ đã ra khỏi sách khai cuộc, bảng sẽ báo "Không có dữ liệu cho thế cờ
này" — đó là bình thường.

## Cách hoạt động

```
chess.com DOM ──► src/content/position.js ──► FEN
                                               │
            src/content/content.js ◄───────────┘
                     │  chrome.runtime.sendMessage
                     ▼
         src/background/service-worker.js ──► explorer.lichess.ovh
                     │  (cache, gộp request trùng, giới hạn tốc độ)
                     ▼
              src/content/ui.js ──► bảng + huy hiệu % trên bàn cờ
```

Thế cờ được đọc từ **hai nguồn độc lập**, vì Chess.com đổi HTML của danh sách
nước đi thường xuyên hơn nhiều so với HTML của quân cờ:

1. **Quân cờ trên bàn** (`<div class="piece wp square-52">`) — cho vị trí chính
   xác nhưng không biết ai đi, quyền nhập thành hay bắt tốt qua đường.
2. **Danh sách nước đi**, phát lại bằng `chess.js` — cho FEN đầy đủ.

Danh sách nước đi chỉ được tin khi vị trí phát lại **khớp** với quân cờ đang
hiển thị. Nhờ vậy tiện ích vẫn đúng khi bạn tua ngược ván, xem biến phụ, hay mở
một puzzle bắt đầu từ thế cờ bất kỳ. Nếu không khớp, tiện ích suy ra lượt đi từ
ô được tô sáng của nước vừa đi, quyền nhập thành từ vị trí vua/xe, và ô bắt tốt
qua đường chỉ khi thực sự có tốt đối phương bắt được.

## Phát triển

```bash
npm install          # chỉ cần cho test và các script build
npm test             # 44 test: đọc thế cờ, API, giao diện, manifest
npm run icons        # tạo lại icons/*.png
npm run zip          # đóng gói dist/chess-move-percent-<version>.zip
npm run bundle:chess # đóng gói lại chess.js (khi nâng phiên bản)
```

Test chạy giao diện và bộ đọc thế cờ trong jsdom với HTML giả lập giống
Chess.com, còn service worker chạy trong sandbox `vm` với `fetch` giả lập — nên
không cần trình duyệt hay kết nối mạng.

### Cấu trúc thư mục

```
manifest.json                   khai báo tiện ích (MV3)
src/content/position.js         đọc DOM Chess.com → FEN
src/content/content.js          theo dõi bàn cờ, điều phối request
src/content/ui.js               bảng thống kê + lớp phủ trên bàn cờ
src/content/styles.css          toàn bộ CSS (tiền tố cmp-)
src/background/service-worker.js  gọi API, cache, giới hạn tốc độ
src/shared/settings.js          mô hình cấu hình dùng chung
src/options/                    trang tùy chọn
src/vendor/chess.bundle.js      chess.js đã đóng gói (BSD-2-Clause)
tools/make-icons.js             sinh icon PNG
tools/package.js                đóng gói .zip cho Chrome Web Store
test/                           test chạy bằng node:test + jsdom
```

### Khi Chess.com đổi giao diện

Nếu bảng báo "Không tìm thấy bàn cờ", thường chỉ cần thêm selector mới vào
`BOARD_SELECTORS` hoặc `MOVE_LIST_SELECTORS` ở đầu `src/content/position.js`.
Phần còn lại không phụ thuộc vào HTML cụ thể.

## Giấy phép

MIT (xem [LICENSE](LICENSE)). Có kèm [chess.js](https://github.com/jhlywa/chess.js)
theo giấy phép BSD-2-Clause — xem `src/vendor/LICENSE-chess.js.txt`.

Dữ liệu khai cuộc thuộc về Lichess, dùng theo
[điều khoản API của Lichess](https://lichess.org/api). Tiện ích này không có
liên kết với Chess.com hay Lichess.
