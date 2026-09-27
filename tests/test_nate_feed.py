import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET
spec = importlib.util.spec_from_file_location("feed", Path(__file__).parents[1] / "scripts/publish_nate_feed.py")
feed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(feed)

class FeedTests(unittest.TestCase):
    def test_scope_is_exact_and_missing_tags_fail_closed(self):
        self.assertTrue(feed.ai_tagged({"postTags": [{"slug": "ai"}]}))
        self.assertFalse(feed.ai_tagged({"postTags": [{"slug": "politics"}]}))
        with self.assertRaises(ValueError):
            feed.ai_tagged({"title": "AI in a title is not a tag"})
        self.assertIsNone(feed.canonical_post_url("https://natesilver.net.evil.test/p/a"))
        self.assertIsNone(feed.canonical_post_url("https://secret@natesilver.net/p/a"))

    def test_refresh_preserves_dates_and_does_not_publish_unverified_items(self):
        xml = b'<rss><channel><item><title>AI</title><link>https://www.natesilver.net/p/yes</link><pubDate>Thu, 17 Sep 2026 14:55:14 GMT</pubDate></item><item><title>Other</title><link>https://www.natesilver.net/p/no</link></item></channel></rss>'
        def fetch(url):
            if url.endswith('/feed'):
                return xml
            return json.dumps({"postTags": [{"slug": "ai" if url.endswith('/yes') else "other"}]}).encode()
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'nate-ai.xml'
            report = feed.refresh(output, fetch=fetch)
            root = ET.parse(output).getroot()
            self.assertEqual(report['published_items'], 1)
            self.assertEqual(root.findtext('./channel/item/pubDate'), 'Thu, 17 Sep 2026 14:55:14 GMT')
            before = output.read_bytes()
            with self.assertRaises(ValueError):
                feed.refresh(output, fetch=lambda url: xml if url.endswith('/feed') else b'{}')
            self.assertEqual(output.read_bytes(), before)

if __name__ == '__main__':
    unittest.main()
