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
| Ván với người **đã kết thúc** | ✅ tự bật ngay tại chỗ | Ván xong rồi thì không còn ai bị thiệt. |
| Ván với người **đang đánh** | ❌ | Đối thủ là người thật đang chơi ván công bằng của họ. |

Ván với người: trong lúc đang đánh thì engine tắt, và **ngay khi ván kết thúc nó
tự bật**, chấm điểm từng nước ngay trên trang đó — không cần mở Game Review.

Để bật, tiện ích cần **dấu hiệu rõ ràng là ván đã xong**: kết quả (`1-0`, `0-1`,
`½-½`), bảng kết thúc ván, hay nút đấu lại — chứ không chỉ dựa vào việc "không
thấy nút đầu hàng". Chess.com đổi tên class thường xuyên; nếu nút đầu hàng
ngừng khớp selector thì "không thấy nút đầu hàng" sẽ âm thầm bị hiểu thành "ván
đã xong" ngay giữa ván của ai đó.

Không có cài đặt nào bật engine trong ván đang đánh với người. Đó là gian lận
theo luật Chess.com: đối thủ mất ván công bằng, còn bạn mất tài khoản.

Thống kê khai cuộc là *sách khai cuộc* chứ không phải engine, nên không bị chặn
theo trang — nhưng nó vẫn là trợ giúp ngoài, hãy tắt (Alt+P) khi đấu với người.

## Tính năng

| | |
|---|---|
| **Điểm trên bàn cờ** | Mỗi nước ứng viên có một nhãn ở **góc ô đích** (không che quân), màu từ xanh (tốt nhất) tới đỏ (sai lầm) |
| **Tỉ lệ thắng** | Mặc định ghi điểm kiểu `62%` thay vì `+0.8`; đổi được trong ⚙ |
| **Màu thật thà** | Thế cờ thua thì mọi nước đều đỏ; nước đáng chọn nhất được viền trắng |
| **Nhiều nước cùng ô** | Hai nước cùng đích (c3 và Nc3) được tách ra và ghi rõ tên nước |
| **Biến chính** | Mỗi nước kèm biến chính dạng SAN, rê chuột để thấy mũi tên trên bàn cờ |
| **Thống kê thật** | Tần suất, thắng/hòa/bại, số ván, Elo trung bình cho từng nước |
| **Tên khai cuộc** | Mã ECO + tên khai cuộc của thế cờ hiện tại |
| **Luyện với bot** | Điểm số cập nhật theo từng nước ngay trong ván với máy |
| **Mổ ván vừa đánh** | Ván với người vừa kết thúc là engine tự bật ngay tại trang đó |
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

## Kiểm tra tiện ích đã chạy chưa

1. Mở `chrome://extensions`, bật **Developer mode**, bấm **Load unpacked** rồi
   chọn thư mục repo. Thẻ tiện ích phải hiện **Chess Move %** và không có chữ
   **Errors** màu đỏ.
2. Sau mỗi lần `git pull`, bấm nút **⟳ Reload** trên thẻ đó — Chrome không tự
   nạp lại mã mới.
3. Mở `chess.com/play/computer`. Bảng hiện ở góc dưới bên phải.
4. Không thấy gì? Bấm biểu tượng tiện ích trên thanh công cụ (hoặc **Alt+P**) —
   bảng luôn hiện ra khi bạn bấm, kể cả khi trang không có bàn cờ.
5. Nếu bảng hiện khung vàng **"Không đọc được bàn cờ"**, bấm **Sao chép** và gửi
   nội dung đó — đó là thông tin cần để sửa selector cho đúng giao diện mới của
   Chess.com.

## Sử dụng

* **Alt+P** hoặc bấm biểu tượng tiện ích: ẩn/hiện bảng.
* Nút **Thống kê / Máy** ở thanh tiêu đề: đổi chế độ.
* Kéo thanh tiêu đề để di chuyển bảng (vị trí được ghi nhớ).
* **⚙**: nguồn dữ liệu, thể loại, mức Elo, độ sâu máy, số nước gợi ý.
* Rê chuột lên một dòng để thấy nước đó trên bàn cờ.

**Điểm số tính theo bên đang đi**: số càng lớn càng tốt cho người sắp đi, nên
nước trên cùng luôn là nước tốt nhất cho bạn. `M3` nghĩa là chiếu hết sau 3
nước. Mặc định điểm ghi theo **tỉ lệ thắng** (`62%`, theo đường cong của
Lichess — hơn một tốt mới khoảng 60%, không phải 100%); muốn kiểu `+0.8` thì
đổi trong ⚙ hoặc trang tùy chọn.

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
npm test             # 158 test: đọc thế cờ, UCI, cổng fair play, API, giao diện, manifest
npm i -D playwright  # chỉ cần cho test:e2e
npm run test:e2e     # nạp tiện ích thật vào Chromium thật, chạy Stockfish thật
npm run icons        # tạo lại icons/*.png
npm run zip          # đóng gói dist/chess-move-percent-<version>.zip
npm run bundle:chess # đóng gói lại chess.js
```

Test chạy giao diện, bộ đọc thế cờ và cổng fair play trong jsdom với HTML giả
lập giống Chess.com; service worker và bộ phân tích UCI chạy trong sandbox `vm`
— không cần trình duyệt hay mạng.

`npm run test:e2e` thì khác: nó nạp **tiện ích thật** vào **Chromium thật**
(`test/e2e/`), kiểm tra manifest nạp được, service worker khởi động, bảng hiện
ra, Stockfish thật chấm điểm 4 nước ở độ sâu 14, và engine từ chối chạy ở trang
đấu với người. Đây là thứ duy nhất bắt được lỗi "tiện ích không nạp được" —
loại lỗi mà test jsdom không thấy.

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
test/e2e/                         test nạp tiện ích thật vào Chromium thật
```

### Khi bảng đứng ở "Đang tính…"

Không bao giờ quá 30 giây nữa: tiện ích tự thử lại một lần, rồi báo lỗi kèm
cách khắc phục. Những đường từng làm nó treo vĩnh viễn đều đã được bịt —
Stockfish chết lúc khởi động, service worker bị Chrome dọn giữa chừng, hay
offscreen document biến mất. Chi tiết trong `test/engine-stall.test.js`.

### Khi Lichess từ chối yêu cầu

Bấm **⚙ → "Kiểm tra kết nối Lichess"**. Nó gọi thẳng API và báo lại **ai đã trả
lời**: URL cuối sau chuyển hướng, header `server`, có đòi xác thực không, và
nội dung trang lỗi. Mã lỗi không phân biệt được Lichess với thứ đứng chặn giữa
đường; những thông tin đó thì có.

Nếu trang lỗi do nginx/apache/proxy sinh ra, hoặc request bị chuyển hướng đi nơi
khác, tiện ích kết luận thẳng: **đây không phải lỗi của Lichess** — proxy, VPN,
DNS lọc hay tiện ích khác đang chặn `explorer.lichess.ovh`. Tên miền `.ovh` hay
bị các danh sách lọc chặn cả cụm vì dính nhiều spam, nên thủ phạm thường là
trình chặn quảng cáo hoặc DNS lọc. Cách thử nhanh không cần tiện ích: mở
`https://explorer.lichess.ovh/masters?fen=...` thẳng trong tab mới — ra cùng
trang lỗi tức là máy/mạng chặn.

Trước khi báo lỗi, tiện ích còn tự thử lại một lần với truy vấn trần (chỉ còn
thế cờ, bỏ hết bộ lọc). Nếu lần đó chạy thì vẫn hiện thống kê, kèm ghi chú
"không áp dụng được bộ lọc". Khi một host đã từ chối, nó nghỉ 60 giây thay vì
bắn lại mỗi nước đi.

**Chế độ Máy không cần mạng** — Stockfish chạy ngay trong trình duyệt, nên nó
vẫn hoạt động đầy đủ kể cả khi Lichess bị chặn.

### Khi Chess.com đổi giao diện

Tiện ích đọc thế cờ theo hai đường độc lập, và **không đường nào cần tên class
của Chess.com giữ nguyên**:

* **Quân cờ trên bàn** — tìm theo selector đã biết, rồi shadow root, rồi phần
  tử cha chung của mọi `.piece.square-XX`.
* **Lớp nhãn toạ độ** — khi không đọc được quân, phần tử chứa các nhãn
  `a`–`h` / `1`–`8` chính là vùng 8×8, dùng để đặt nhãn % cho khớp ô. Không có
  nó thì lấy phần tử vuông **nhỏ nhất** đủ lớn: bàn cờ nằm trong các khung
  layout cũng vuông nhưng to hơn nhiều, chọn cái to nhất là lệch hết.
  Phần tử ứng viên còn phải **gần như không có chữ** (≤ 40 ký tự) và không
  chứa danh sách nước đi — thanh bên và khung quảng cáo cũng hay vuông, và
  chúng đầy chữ.
* **Danh sách nước đi** — tìm theo selector, và nếu trượt thì **tìm theo nội
  dung**: quét các phần tử có chữ đọc được như một nước cờ, rồi chọn phần tử
  cha chứa cụm dày đặc nhất (tính điểm theo `số nước² / số phần tử con`, để một
  nước lọt vào khung chat không kéo cả `<body>` thành danh sách nước đi).

Trên các trang bot mới của Chess.com, quân cờ **vẽ bằng canvas** nên không đọc
được từ DOM — bàn cờ chỉ còn nhãn toạ độ. Khi đó tiện ích dựng lại thế cờ **chỉ
từ danh sách nước đi** và ghi "đọc từ danh sách nước đi" trong bảng. Hướng bàn
cờ lấy từ nhãn số hàng trong SVG toạ độ, không cần class `flipped`.

Danh sách nước đi của Chess.com vẽ ký hiệu quân bằng **hình**, nên chữ đọc được
chỉ còn `"f3"` thay vì `"Nf3"`, `"xd4"` thay vì `"Nxd4"`. Tiện ích xử lý theo
thứ tự:

1. Đọc tên quân từ chính hình đó — `data-figurine`, tên class, `alt`,
   `aria-label`, đường dẫn ảnh, id sprite SVG, ảnh nền CSS, hay ký tự Unicode.
2. Nếu không đọc được: chỉ cần biết **có** một hình là đủ để loại trừ nước tốt,
   rồi đối chiếu với **các nước hợp lệ** trong thế cờ đó.
3. Nếu vẫn còn hai cách hiểu (`xd4` có thể là `Nxd4` hoặc `Qxd4`): thử cả hai và
   chơi tiếp phần còn lại của ván — nước sai thường làm một nước sau đó thành
   bất hợp lệ.
4. Nếu cả hai cách đều hợp lệ đến hết ván: **từ chối**, không đoán. Gợi ý sai
   còn tệ hơn không có gợi ý.

Việc quét toàn trang chỉ chạy **một lần**; sau đó phần tử bàn cờ và khung danh
sách nước đi được nhớ lại, nên mỗi lần đọc tiếp theo chỉ tốn ~1ms thay vì
~200ms.

Nếu vẫn hỏng, bảng sẽ hiện khung chẩn đoán (số quân cờ, số ô, selector nào khớp)
thay vì biến mất. Thường chỉ cần thêm selector mới vào `BOARD_SELECTORS` hoặc
`MOVE_LIST_SELECTORS` ở đầu `src/content/position.js`.
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
