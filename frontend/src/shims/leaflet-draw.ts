// react-leaflet-draw imports `Draw` as a default export from `leaflet-draw`.
// The upstream `leaflet-draw` package is UMD and does not provide an ES default export.
// This shim:
//  - ensures `window.L` exists (leaflet-draw expects it)
//  - loads the real plugin for side effects
//  - provides a default export so Vite/react-leaflet-draw can compile

import L from 'leaflet'

;(window as any).L = L
import 'leaflet-draw/dist/leaflet.draw.js'

export default undefined as unknown

