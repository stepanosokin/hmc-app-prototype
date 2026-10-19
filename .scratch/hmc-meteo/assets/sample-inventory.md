# Supplied GRIB2 sample: preliminary inventory

Inspected 2026-10-19 using direct reads of GRIB binary sections. No values were decompressed. Source: `data/grib/ICON_EU_T_G_2026101500.grib2` (ignored local data).

| Property | Observed metadata |
| --- | --- |
| File size | 26,658,586 bytes |
| Message count | 24 |
| Reference time | 2026-10-15 00:00 UTC |
| Forecast lead times | +1 through +24 hours, hourly |
| Discipline/category/parameter | 0/0/0 in every message |
| First fixed surface | Type 1, scale/value 0 |
| Grid | Template 3.0; 1377 × 657 = 904,689 points |
| Spacing | 0.0625 degrees |
| Geographic extent | Longitude −23.5 to 62.5 degrees; latitude 29.5 to 70.5 degrees |
| Originating center | 78 |
| Product template | 4.0 |
| Packing template | 5.42 |

Interpretation to verify with a standards-aware decoder: temperature at the encoded ground/water surface. Do not label this as 2 m air temperature. No wind component fields were identified.

Outstanding: successful decoding, units, missing-value treatment, numerical ranges, spatial orientation, and a repeatable ingestion inventory. These are validation requirements, not established results.

Environment: Docker and Node/npm are on PATH. Python resolves to a Windows Store stub; no GDAL/GRIB command-line decoder was found on PATH. No packages were installed.
