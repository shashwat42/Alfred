"""Compare immutable image config digests across Docker image-store formats."""
import hashlib
import json
import subprocess
import tarfile


def archive_identity(stream, image_name):
    configs = {}
    manifest = None
    with tarfile.open(fileobj=stream, mode="r|*") as archive:
        for member in archive:
            # Never extract archive paths or retain image layers in memory.
            if not member.isfile() or member.size > 4 * 1024 * 1024:
                continue
            content = archive.extractfile(member).read()
            if member.name == "manifest.json":
                manifest = json.loads(content)
                continue
            try:
                value = json.loads(content)
            except (ValueError, UnicodeDecodeError):
                continue
            if isinstance(value, dict) and all(key in value for key in ("rootfs", "config", "architecture", "os")):
                configs[member.name] = {
                    "configDigest": "sha256:" + hashlib.sha256(content).hexdigest(),
                    "platform": value["os"] + "/" + value["architecture"],
                }
    entries = [entry for entry in (manifest or []) if any(
        tag in (image_name, "docker.io/library/" + image_name)
        for tag in entry.get("RepoTags", [])
    )]
    if len(entries) != 1 or entries[0]["Config"] not in configs:
        raise ValueError("Archive must contain exactly the requested image configuration")
    return configs[entries[0]["Config"]]


def loaded_identity(image_name):
    process = subprocess.Popen(["docker", "image", "save", image_name], stdout=subprocess.PIPE)
    try:
        identity = archive_identity(process.stdout, image_name)
    finally:
        process.stdout.close()
        code = process.wait()
    if code:
        raise ValueError("Could not inspect loaded image configuration")
    return identity
