"""Public cache observations: bounded state, cold failures and warm retained reads."""

import unittest

from publication.tile_cache import TileCache
from publication.domain import PublicationUnavailable


class Diagnostics(unittest.TestCase):
    def test_cache_observations_preserve_retained_bytes_after_failed_generation(self):
        cache = TileCache(cap=332820)
        payload = bytes(332820)
        self.assertEqual(cache.get(('a',), lambda: payload), payload)
        self.assertEqual(cache.get(('a',), lambda: self.fail('warm cache regenerated')), payload)

        def broken():
            raise OSError('secret=must-never-be-retained')

        with self.assertRaises(PublicationUnavailable):
            cache.get(('b',), broken)
        report = cache.snapshot()
        self.assertEqual(report['numeric_miss'], 1)
        self.assertEqual(report['numeric_hit'], 1)
        self.assertEqual(report['numeric_failure'], 1)
        self.assertEqual(report['bytes'], 332820)
        self.assertEqual(report['entries'], 1)
        self.assertNotIn('secret', str(report))
        self.assertEqual(cache.get(('a',), broken), payload)


if __name__ == '__main__':
    unittest.main()
