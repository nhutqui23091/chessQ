# Stockfish (vendored)

`stockfish.wasm.js` + `stockfish.wasm` come from
[stockfish.js](https://github.com/niklasf/stockfish.js) v10.0.2 (npm
`stockfish.js@10.0.2`), an Emscripten build of
[Stockfish](https://stockfishchess.org/).

* `stockfish.wasm.js` is loaded as a Web Worker and speaks the UCI protocol
  over `postMessage`.
* It fetches `stockfish.wasm` from its own directory, so the two files must
  stay side by side.

Stockfish is **GPL-3.0**, see `LICENSE-stockfish.txt`. Because this extension
ships Stockfish, the whole project is GPL-3.0 as well — see the repository
`LICENSE`.

No build step is needed to update: copy both files out of a newer npm tarball.
