# Element provenance seam

paikko's `<ReportButton>` resolves a clicked DOM element back to its source
`file:line:column` and owning component. That mapping must be injected at build
time onto every JSX element as a `data-src` (and `data-component`) attribute.

## Decision: SWC (default), Babel as the escape hatch

Next 14 compiles with SWC by default. Two viable injection points:

1. **SWC plugin (preferred)** - a Wasm SWC transform that adds `data-src` to JSX
   opening elements. Wire it via `experimental.swcPlugins` in `next.config.js`
   (the slot is already stubbed there, commented out). Fastest, keeps Next on its
   native toolchain, no opt-out of SWC features.

2. **Babel fallback** - dropping a `.babelrc` at the repo root makes Next switch
   the whole project to Babel. Then a custom Babel plugin
   (similar to React's `@babel/plugin-transform-react-jsx-source`, which already
   emits `__source={fileName,lineNumber}` in dev) writes `data-src`. Simpler to
   author than an SWC Wasm plugin, but disables SWC-only optimizations.

There is intentionally **no `.babelrc` committed** - adding one flips the whole
build to Babel. The provenance agent picks one path and wires it; until then the
SWC slot in `next.config.js` is the intended home.

`data-src` format: `"<relative/path>:<line>:<col>"`. `data-component` carries the
nearest React component display name. `ReportButton` reads these off the clicked
element to populate `report.target.{src,component,selector}`.
