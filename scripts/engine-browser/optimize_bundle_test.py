import gzip
import io
import unittest
from PIL import Image
from optimize_bundle import compress_program, optimize_png


class LosslessTests(unittest.TestCase):
    def test_program_keeps_exact_decoded_bytes(self):
        raw = b'\0asm\x01\0\0\0' + bytes(range(256)) * 100
        packed = gzip.compress(raw, compresslevel=1, mtime=0)
        optimized = compress_program(packed)
        self.assertEqual(gzip.decompress(optimized), raw)
        self.assertLessEqual(len(optimized), len(packed))

    def test_non_program_is_refused(self):
        with self.assertRaises(ValueError):
            compress_program(gzip.compress(b'not a program'))

    def test_png_keeps_every_pixel_and_dimensions(self):
        image = Image.new('RGBA', (19, 23), (4, 80, 120, 90))
        output = io.BytesIO()
        image.save(output, format='PNG', compress_level=0)
        optimized = optimize_png(output.getvalue())
        readback = Image.open(io.BytesIO(optimized))
        self.assertEqual(readback.size, (19, 23))
        self.assertEqual(readback.tobytes(), image.tobytes())
        self.assertLess(len(optimized), len(output.getvalue()))


if __name__ == '__main__':
    unittest.main()