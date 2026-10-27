"""Explicit old-policy fixture for exercising the real operator migration CLI."""
from test_field_nodata import PublishedNoData

selection, _ = PublishedNoData().seed([0, 280, 281, 282] * 3, legacy=True)
print(selection)
