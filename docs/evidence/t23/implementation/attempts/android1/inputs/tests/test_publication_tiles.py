"""Numeric boundary supplement; actual-sample and gateway gates are separate."""

import unittest

import numpy as np

from publication.tiles import bilinear, decode, encode, coordinates


class NumericTileContract(unittest.TestCase):
    def test_bilinear_mask_edges_and_wire_roundtrip(self):
        # Independently worked 2x2 surface: centre = (280+282+284+286)/4.
        values = np.array([[280., 282.], [284., 286.]])
        missing = np.array([[False, False], [False, False]])
        lon = np.array([[0.5, 0., -0.5, -0.5001]])
        lat = np.array([[0.5, 0., 0., 0.]])
        actual, valid = bilinear(values, missing, lon, lat, [-0.5, -0.5, 1.5, 1.5], [1., 1.])
        np.testing.assert_array_equal(valid, [[1, 1, 1, 0]])
        np.testing.assert_array_equal(actual, [[283., 280., 280., 0.]])
        for encoding in ('f32', 'png'):
            restored, restored_valid = decode(encode(actual, valid, encoding), encoding, actual.shape)
            np.testing.assert_array_equal(restored_valid, valid)
            np.testing.assert_allclose(restored, actual, rtol=0, atol=0.001)
        missing[1, 1] = True
        _, valid = bilinear(values, missing, lon, lat, [-0.5, -0.5, 1.5, 1.5], [1., 1.])
        # A zero-weight missing neighbour must not invalidate an exact cell.
        np.testing.assert_array_equal(valid, [[0, 1, 1, 0]])

    def test_neighboring_halos_have_identical_global_coordinates(self):
        left_lon, left_lat = coordinates(3, 4, 2)
        right_lon, right_lat = coordinates(3, 5, 2)
        np.testing.assert_array_equal(left_lon[:, -2:], right_lon[:, :2])
        np.testing.assert_array_equal(left_lat[:, -2:], right_lat[:, :2])


if __name__ == '__main__':
    unittest.main()
