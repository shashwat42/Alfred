import hashlib
import io
import json
import tarfile
import unittest
from image_identity import archive_identity


def fixture(config_path, tag="alfred-backend:fixture", layer=False):
    config = json.dumps({"os": "linux", "architecture": "amd64", "config": {"Cmd": ["node", "server.ts"]}, "rootfs": {"type": "layers", "diff_ids": []}}).encode()
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as archive:
        for name, content in [
            (config_path, config),
            ("layer.tar", b"not configuration") if layer else ("index.json", b"{}"),
            ("manifest.json", json.dumps([{"Config": config_path, "RepoTags": [tag], "Layers": []}]).encode()),
        ]:
            member = tarfile.TarInfo(name)
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
    stream.seek(0)
    return stream, "sha256:" + hashlib.sha256(config).hexdigest()


class ImageIdentityTests(unittest.TestCase):
    def test_classic_and_containerd_archives_have_identical_identity(self):
        identities = []
        for config_path in ("classic-config.json", "blobs/sha256/config-digest"):
            stream, digest = fixture(config_path, layer=True)
            actual = archive_identity(stream, "alfred-backend:fixture")
            self.assertEqual(actual, {"configDigest": digest, "platform": "linux/amd64"})
            identities.append(actual)
        self.assertEqual(identities[0], identities[1])

    def test_wrong_image_tag_is_rejected(self):
        stream, _ = fixture("config.json", tag="another-image:fixture")
        with self.assertRaises(ValueError):
            archive_identity(stream, "alfred-backend:fixture")
