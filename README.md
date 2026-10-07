# Chess Move % — tiện ích cho Chess.com

Tiện ích Chrome (Manifest V3) cho thế cờ đang mở trên Chess.com, hai chế độ:

* **Thống kê** — tần suất (%) từng nước đi và tỉ lệ thắng/hòa/bại trong hàng
  triệu ván thật, lấy từ [Lichess opening explorer](https://lichess.org/analysis).
* **Máy phân tích** — điểm số Stockfish cho từng nước, hiện ngay trên ô đích và
  tô màu theo chất lượng nước đi. Chạy **trực tiếp trong ván khi bạn luyện với
  máy**, và trên bàn phân tích. Không chạy trong ván với người thật — xem
  [Fair play](#fair-play).

Cả hai chế độ đều vẽ huy hiệu lên bàn cờ và liệt kê chi tiết trong một bảng nhỏ
kéo thả được.

## Fair play

Ranh giới là **ai ngồi bên kia bàn cờ**.

| Trang | Engine | Vì sao |
|---|---|---|
| `chess.com/play/computer` | ✅ chạy trực tiếp trong ván | Đối thủ là bot: không ai bị thiệt, elo không đổi. Chess.com cũng tự cho gợi ý ở đây. |
| `chess.com/analysis` (gồm Game Review) | ✅ | Ôn khai cuộc, mổ lại ván đã đấu. |
| `/play/online`, `/game/live/…`, `/game/daily/…` | ❌ | Đối thủ là **người thật**. |

Trong ván với người thật, engine không chạy — không có cài đặt nào bật được, và
trên bàn phân tích nó cũng tự tắt nếu trang vẫn còn nút đầu hàng của một ván
đang diễn ra. Dùng engine khi đấu với người là gian lận theo luật Chess.com:
đối thủ mất ván công bằng, còn bạn mất tài khoản.

Thống kê khai cuộc là *sách khai cuộc* chứ không phải engine, nên không bị chặn
theo trang — nhưng nó vẫn là trợ giúp ngoài, hãy tắt (Alt+P) khi đấu với người.

## Tính năng

| | |
|---|---|
| **Điểm trên bàn cờ** | Mỗi nước ứng viên có một huy hiệu điểm ngay ô đích, màu từ xanh (tốt nhất) tới đỏ (sai lầm) |
| **Nhiều nước cùng ô** | Hai nước cùng đích (c3 và Nc3) được tách ra và ghi rõ tên nước |
| **Biến chính** | Mỗi nước kèm biến chính dạng SAN, rê chuột để thấy mũi tên trên bàn cờ |
| **Thống kê thật** | Tần suất, thắng/hòa/bại, số ván, Elo trung bình cho từng nước |
| **Tên khai cuộc** | Mã ECO + tên khai cuộc của thế cờ hiện tại |
| **Luyện với bot** | Điểm số cập nhật theo từng nước ngay trong ván với máy |
| **Theo dõi mọi chế độ** | Ván trực tiếp, phân tích, xem lại ván, puzzle, bàn cờ lật ngược |
| **Bộ lọc** | Thể loại, mức Elo, độ sâu máy, số nước gợi ý |

Tiện ích chỉ **đọc** thế cờ từ giao diện; nó không tự đi nước nào, không gửi gì
về máy chủ nào ngoài Lichess, và không đọc tài khoản của bạn. Engine chạy hoàn
toàn trong máy bạn (WebAssembly).

## Cài đặt

Chưa có trên Chrome Web Store, cài thủ công:

1. `git clone https://github.com/nhutqui23091/chessQ.git`
2. Mở `chrome://extensions`.
3. Bật **Developer mode** (góc trên bên phải).
4. **Load unpacked** → chọn thư mục vừa tải.
5. Mở một ván trên chess.com — bảng hiện ở góc dưới bên phải.

Không cần build: `chess.bundle.js` và Stockfish đã đóng gói sẵn trong repo.

## Sử dụng

* **Alt+P** hoặc bấm biểu tượng tiện ích: ẩn/hiện bảng.
* Nút **Thống kê / Máy** ở thanh tiêu đề: đổi chế độ.
* Kéo thanh tiêu đề để di chuyển bảng (vị trí được ghi nhớ).
* **⚙**: nguồn dữ liệu, thể loại, mức Elo, độ sâu máy, số nước gợi ý.
* Rê chuột lên một dòng để thấy nước đó trên bàn cờ.

**Điểm số tính theo bên đang đi**: số càng lớn càng tốt cho người sắp đi, nên
nước trên cùng luôn là nước tốt nhất cho bạn. `M3` nghĩa là chiếu hết sau 3 nước.

## Cách hoạt động

```
chess.com DOM ──► src/content/position.js ──► FEN
                                               │
                     src/content/content.js ◄──┘
                       │                   │
        chế độ Thống kê│                   │chế độ Máy (qua src/content/context.js)
                       ▼                   ▼
   explorer.lichess.ovh                offscreen document
   (cache + gộp request)               └─► Stockfish WASM (Web Worker, UCI)
                       │                   │
                       └──────►  src/content/ui.js  ◄──┘
                                 bảng + huy hiệu trên bàn cờ
```

Máy phân tích sống trong một **offscreen document** vì service worker của MV3
không tạo được Web Worker, còn Stockfish thì cần. Service worker giữ vòng đời
tài liệu đó, bắt tay chờ engine sẵn sàng, và chuyển kết quả về đúng tab. Kết quả
được gửi dần theo từng độ sâu nên điểm số hiện ngay rồi mới chính xác dần.

### Đọc thế cờ

Thế cờ đọc từ **hai nguồn độc lập**, vì Chess.com đổi HTML của danh sách nước đi
thường xuyên hơn nhiều so với HTML của quân cờ:

1. **Quân cờ trên bàn** (`<div class="piece wp square-52">`) — vị trí chính xác
   nhưng không biết ai đi, quyền nhập thành hay bắt tốt qua đường.
2. **Danh sách nước đi**, phát lại bằng `chess.js` — cho FEN đầy đủ.

Danh sách nước đi chỉ được tin khi vị trí phát lại **khớp** với quân cờ đang
hiển thị, nên tua ngược ván, xem biến phụ hay mở puzzle từ thế cờ bất kỳ đều
đúng. Nếu không khớp, tiện ích suy lượt đi từ ô tô sáng của nước vừa đi, quyền
nhập thành từ vị trí vua/xe, và ô bắt tốt qua đường chỉ khi thật sự có tốt bắt
được.

## Phát triển

```bash
npm install          # chỉ cần cho test và script build
npm test             # 97 test: đọc thế cờ, UCI, cổng fair play, API, giao diện, manifest
npm run icons        # tạo lại icons/*.png
npm run zip          # đóng gói dist/chess-move-percent-<version>.zip
npm run bundle:chess # đóng gói lại chess.js
```

Test chạy giao diện, bộ đọc thế cờ và cổng fair play trong jsdom với HTML giả
lập giống Chess.com; service worker và bộ phân tích UCI chạy trong sandbox `vm`
— không cần trình duyệt hay mạng.

### Cấu trúc thư mục

```
manifest.json                     khai báo tiện ích (MV3)
src/content/position.js           đọc DOM Chess.com → FEN
src/content/context.js            cổng fair play: engine được phép chạy ở trang nào
src/content/content.js            theo dõi bàn cờ, điều phối hai chế độ
src/content/ui.js                 bảng + lớp phủ trên bàn cờ
src/content/styles.css            toàn bộ CSS (tiền tố cmp-)
src/background/service-worker.js  API Lichess, cache, vòng đời offscreen
src/offscreen/engine.{html,js}    chạy Stockfish, nói UCI
src/shared/settings.js            mô hình cấu hình dùng chung
src/shared/uci.js                 phân tích đầu ra UCI (thuần, dễ test)
src/options/                      trang tùy chọn
src/vendor/chess.bundle.js        chess.js đã đóng gói (BSD-2-Clause)
src/vendor/stockfish/             Stockfish WASM (GPL-3.0)
tools/                            sinh icon, đóng gói .zip
test/                             test chạy bằng node:test + jsdom
```

### Khi Chess.com đổi giao diện

Nếu bảng báo "Không tìm thấy bàn cờ", thường chỉ cần thêm selector mới vào
`BOARD_SELECTORS` hoặc `MOVE_LIST_SELECTORS` ở đầu `src/content/position.js`.
Nếu Chess.com đổi đường dẫn trang đấu với máy, cập nhật `ALLOWED_CONTEXTS`
trong `src/content/context.js`; nếu nút đầu hàng đổi tên thì sửa
`LIVE_CONTROL_SELECTORS` ngay dưới đó — đó là thứ giữ cho engine không chạy
trong ván với người thật.

## Giấy phép

**GPL-3.0** (xem [LICENSE](LICENSE)) vì tiện ích đóng gói kèm Stockfish. Chi
tiết các thành phần: [NOTICE.md](NOTICE.md).

Dữ liệu khai cuộc thuộc về Lichess, dùng theo
[điều khoản API của Lichess](https://lichess.org/api). Tiện ích không có liên
kết với Chess.com, Lichess hay nhóm phát triển Stockfish.
