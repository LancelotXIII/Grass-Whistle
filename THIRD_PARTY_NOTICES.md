# Third-party notices

Grasswhistle is released under the [MIT License](LICENSE). Retain the copyright line in `LICENSE` when you redistribute source or binaries.

## Bundled runtime and build dependencies

This application includes or depends on open-source packages. Each package’s license is in its npm package (see `node_modules/<name>/LICENSE` after install). Notable direct dependencies:

| Package | SPDX (typical) | Notes |
| :--- | :--- | :--- |
| [Electron](https://www.electronjs.org/) | MIT | Desktop shell |
| [React](https://react.dev/) | MIT | UI |
| [Vite](https://vitejs.dev/) | MIT | Renderer build |
| [simplex-noise](https://www.npmjs.com/package/simplex-noise) | MIT | Procedural noise |
| [jszip](https://stuk.github.io/jszip/) | MIT or dual MIT/GPL (see package) | ZIP export |
| [@hyrious/marshal](https://github.com/hyrious/marshal) | MIT | Ruby Marshal (used by vendored `tools/RXConverter` for RMXP `.rxdata` export) |

## Fonts (renderer)

The UI loads web fonts from Google Fonts in `index.html`:

- [Fraunces](https://fonts.google.com/specimen/Fraunces) — [SIL Open Font License 1.1](https://openfontlicense.org/open-font-license-official-text/)
- [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) — SIL OFL 1.1
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) — SIL OFL 1.1

When redistributing a build, ensure your use of these fonts complies with the OFL (attribution is preserved here and in the font projects’ notices).
