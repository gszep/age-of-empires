"""Source-identity sharing must change neither atlas pixels nor frame semantics."""
import json
from pathlib import Path
import unittest

from convert_sld import atlas_jobs, published, shared_atlas_jobs
from civilization_profiles import art_entities


class AtlasSharingTest(unittest.TestCase):
    def job(self, key, source="sail.sld", expected=40, scale=2):
        return {"key": key, "name": "idle", "source": source, "expected": expected,
                "scale": scale, "layers": ("shadow", "playercolor", "outline")}

    def test_identical_sources_share_each_layer_independent_of_input_order(self):
        jobs = [self.job("galley"), self.job("cannon-galleon", "alias.sld")]
        hashes = {"sail.sld": "abc", "alias.sld": "abc"}
        groups = shared_atlas_jobs(jobs, hashes)
        self.assertEqual(groups, shared_atlas_jobs(list(reversed(jobs)), hashes))
        self.assertEqual(len(groups), 4)
        self.assertTrue(all(len(group) == 2 for group in groups))
        self.assertTrue(all(group[0][1]["key"] == "cannon-galleon" for group in groups))
        # Main RGB, shade RGB and neutral masks must never share a group.
        for group in groups:
            self.assertEqual(len({member[3] for member in group}), 1)

    def test_changed_source_frame_count_and_unhashed_sources_do_not_alias(self):
        jobs = [self.job("a"), self.job("b", expected=41), self.job("c", "changed.sld"),
                self.job("d", "unknown.sld"), self.job("e", "unknown.sld")]
        groups = shared_atlas_jobs(jobs, {"sail.sld": "abc", "changed.sld": "def"})
        self.assertEqual(len(groups), 20)
        self.assertTrue(all(len(group) == 1 for group in groups))

    def test_shared_multi_page_art_keeps_per_use_scale_and_every_frame(self):
        jobs = [self.job("a", scale=1), self.job("b", scale=2)]
        main = next(group for group in shared_atlas_jobs(jobs, {"sail.sld": "abc"}) if group[0][3] is None)
        frames = [{"x": 0, "y": 0, "w": 8, "h": 8, "cx": 3, "cy": 5, "page": 1}]
        atlas = {"size": [16, 16], "pages": [[16, 16], [8, 8]], "framesInFile": 40, "frames": frames}
        entries = [published(atlas, main[0][2], member[1]["scale"]) for member in main]
        self.assertEqual(entries[0]["pages"], entries[1]["pages"])
        self.assertEqual(entries[0]["pages"][1]["image"], "a/idle-p1.png")
        self.assertNotIn("scale", entries[0])
        self.assertEqual(entries[1]["scale"], 2)
        self.assertEqual(entries[0]["frames"], frames)
        self.assertEqual(entries[1]["framesInFile"], 40)

    @unittest.skipUnless(Path("public/imported/aoe2/manifest.json").is_file(), "no owned manifest")
    def test_published_groups_use_one_existing_page_set_without_losing_members(self):
        path = Path("public/imported/aoe2/manifest.json")
        manifest = json.loads(path.read_text())
        entities = art_entities(manifest)
        groups = shared_atlas_jobs(atlas_jobs(manifest), manifest["source"]["sha256"])
        shared = 0
        for group in groups:
            entries = []
            for identifier, job, _image, layer in group:
                entity = entities[job["key"]]
                atlases = {**entity["atlases"]}
                for annex in entity.get("annexes", []):
                    atlases.update(annex["atlases"])
                name = job["name"] + (f"-{layer}" if layer else "")
                entries.append(atlases.get(name))
            if not any(entries):  # empty or undecodable mask
                continue
            self.assertTrue(all(entries), group[0][0])
            for entry in entries:
                self.assertEqual(entry["image"], group[0][2])
                for page in entry.get("pages", [entry]):
                    self.assertTrue((path.parent / page["image"]).is_file())
                self.assertEqual(entry["frames"], entries[0]["frames"])
                self.assertEqual(entry["size"], entries[0]["size"])
            shared += len(entries) - 1
        self.assertGreater(shared, 0, "fixture actually contains shared art")


if __name__ == "__main__":
    unittest.main()
