# Giấy phép và thành phần đi kèm

Dự án này phát hành theo **GPL-3.0** (xem `LICENSE`).

Lý do: tiện ích đóng gói kèm [Stockfish](https://stockfishchess.org/) — một
chương trình GPL-3.0 — nên toàn bộ bản phân phối phải dùng cùng giấy phép.
Trước khi thêm engine, phần mã của dự án dùng giấy phép MIT.

| Thành phần | Giấy phép | Vị trí |
|---|---|---|
| Stockfish 10 (bản WASM qua [stockfish.js](https://github.com/niklasf/stockfish.js)) | GPL-3.0 | `src/vendor/stockfish/` |
| [chess.js](https://github.com/jhlywa/chess.js) 1.4.0 | BSD-2-Clause | `src/vendor/chess.bundle.js` |

Dữ liệu khai cuộc lấy từ [Lichess opening explorer](https://lichess.org/api)
khi chạy, không đóng gói kèm.

Tiện ích không có liên kết với Chess.com, Lichess hay nhóm phát triển Stockfish.
