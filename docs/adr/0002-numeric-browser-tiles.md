---
status: accepted
---

# Numeric tiles and browser GPU rendering

On 2026-10-19 the user requested numeric data tiles and browser GPU rendering, then instructed updating the specification and affected tickets. Replace the initial browser colour-image delivery path with versioned numeric tiles and a MapLibre custom GPU layer, while keeping the Zarr numerical core, canonical point/EDR APIs and GeoServer temporal WMS for QGIS. This accepted direction is recorded in bilingual specification v0.3 and parent #12, preserving M1–M5 and A1–A12. The completed planning map remains historical. No tile format, tiler or browser performance result is selected by this record.

## Delivery path

`Manifest-selected Zarr assets → numeric tile generation/cache → gateway → browser decoding/GPU textures → MapLibre weather layer`.

The tiler can be integrated with the existing Python API/worker responsibilities; a new standalone service is not a requirement. Compare GeoServer reuse, an existing numeric-tiling toolkit and a small project implementation in #16 before adding dependencies; use GeoServer where it meets the numeric contract, including values, masks and forecast dimensions. [MapLibre custom layers](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/) permit custom GPU rendering; [TiTiler's numerical output documentation](https://developmentseed.org/titiler/user_guide/output_format/) establishes an available array-plus-mask option, not a selected project encoding or proof of compatibility.

## Consequences and validation

- Freeze the tile contract: matrix set/projection, tile dimensions and orientation, bands, dtype/byte order or scale/offset encoding, units, nodata mask, resampling, compression and versioned metadata. Evaluate float arrays and packed image encodings with actual browser decoding and upload costs; ordinary coloured PNGs do not provide this contract.
- Include run, revision, field/level, exact valid time, grid/member, tile matrix/coordinates, resampling and encoding version in tile identity. Browser requests keep the user's selection pinned. A colour palette can change locally without downloading unchanged numeric tiles; style/shader versions still belong in relevant rendered-product identities.
- Publish only manifest-eligible tiles and apply the same availability/access/retention rules before protected cache delivery. A failed update preserves the previous usable revision; new tiles must participate in the real publication visibility gate.
- Begin with the actual scalar surface-temperature sample. Validate source-sphere/geographic-to-map projection, orientation, adjacent-tile seams/halos, masks and declared display precision against the decoded baseline. Canonical point reads retain nearest-native-cell/exact-time semantics; resampled or GPU-interpolated display values have their own explicit meaning and tolerance.
- Benchmark cold/warm tile delivery, transferred bytes, decode/upload time, server resources and browser frame time/GPU memory on declared desktop/mobile browsers. Agree targets before claiming readiness; compare with the cached-image baseline. Detect unsupported GPU capabilities and decide an explicit user-visible fallback.
- Preserve Russian/UTC selection and missing-time behavior. Do not interpolate across missing times or mix runs/revisions. Time blending and wind-particle advection require separate semantics and evidence; the supplied temperature sample cannot validate U/V components, and particles remain deferred unless their scope is explicitly expanded.

The [English specification](../../.scratch/hmc-meteo/spec.md), [Russian specification](../../.scratch/hmc-meteo/spec.ru.md) and [implementation parent #12](https://github.com/stepanosokin/hmc-app-prototype/issues/12) carry the amended contract. #16 owns the tile-engine/encoding decision and delivery foundation; #25 owns the GPU scalar renderer; #31 owns measured server/browser performance. Downstream publication, access, retention and handoff tickets include the new path. The point/metadata results and adapter choice from #15 remain valid for those measured operations; they neither measure tile serving nor establish GPU-rendering suitability. Choosing pygeoapi for standards adaptation remains independent of the browser tile encoder/renderer choice.
