# Scientific contracts and evidence

Before selecting an encoding or coordinate operation, resolve the ticket's
agreement gates. For this project, native spherical coordinates, WGS84 geodetic
coordinates and projected display coordinates have distinct meanings. Read the
versioned contract and operative CRS definitions before altering any of them;
record height handling and the forward/inverse direction. The approved v2 datum
relationship is a prototype hypothesis. T2's COG precision bound is separate
from display resampling/encoding budgets and geodetic placement accuracy.

Keep an independent numerical reference and retain failed compatibility probes.
Successful tests on a candidate configuration establish only that configuration.
Reuse verified immutable samplers while checking catalogue eligibility on each
request; compare numerical/GIS identity and placement through the gateway.

For cached numerical readers, exercise loss of an expected array and an expected
chunk after warming the sampler. Consolidated Zarr metadata can survive missing
files and return fill values as apparent success. Use the verified manifest's
file inventory to distinguish unavailable published storage from legitimate
sparse fill or native nodata. Reuse the public point/EDR fault-and-recovery case
in [test_publication_numerical.py](../../tests/test_publication_numerical.py).

Before changing shared configuration, read its current contents. Existing
`.gitattributes` rules preserve tracked fixtures; preserve archived raw bytes
outside Git under [external storage rules](../validation/evidence-storage.md).
`tools/check_evidence.py` verifies the T3
artifact index, T4's archived selection/contract hashes and T5-T12 report/input
artifact index and T22's browser archive. These are historical records: compare each against its recorded
inputs, rather than against future
dependency locks or a new contract revision. New evidence must bind its exact
inputs, configuration, browser fixture and process results before selection.

Validate the first complete development archive before expensive final service
gates. Compare runner and browser input sets, including basemaps and worker
scripts outside the code directories. If combining separately recorded hashes,
preserve original reports and record the union's provenance and conflicts;
verify source bytes before freezing the final inputs.
