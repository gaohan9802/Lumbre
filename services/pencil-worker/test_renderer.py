import unittest

from renderer import render


class RendererTest(unittest.TestCase):
    def test_both_styles_render_png(self):
        scene = {"elements": [
            {"kind": "blob", "x": 230, "y": 260, "w": 340, "h": 280, "color": "orange"},
            {"kind": "path", "points": [[120, 700], [500, 620], [820, 730]], "color": "red"},
        ]}
        for style in ("crayon", "penwash"):
            output = render({"style": style, "title": "回家", "note": "一起走", "scene": scene})
            self.assertTrue(output.startswith(b"\x89PNG\r\n\x1a\n"))
            self.assertLess(len(output), 8 * 1024 * 1024)

    def test_invalid_elements_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "unsupported scene element"):
            render({"style": "crayon", "scene": {"elements": [{"kind": "script", "code": "open('/etc/passwd')"}]}})


if __name__ == "__main__":
    unittest.main()

