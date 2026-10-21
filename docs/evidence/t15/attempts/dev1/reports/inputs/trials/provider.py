"""pygeoapi 0.24.0 EDR plugin delegating to the identical domain sampler."""

from flask import g
from pygeoapi.provider.base_edr import BaseEDRProvider
from pyproj import CRS

from trials.service import coverage


class ManifestEDRProvider(BaseEDRProvider):
    def __init__(self, provider_def):
        super().__init__({**provider_def, 'storage_crs': CRS.from_proj4('+proj=longlat +R=6371229 +no_defs')})
        self._fields = {'T_G': {'type': 'number', 'title': 'Ground surface temperature', 'x-ogc-unit': 'K'}}

    def get_fields(self):
        return self._fields

    def position(self, **kwargs):
        # Run/revision are project extensions not forwarded by stock pygeoapi.
        # The HTTP integration validates/binds them in this request context.
        return coverage(g.selection)
