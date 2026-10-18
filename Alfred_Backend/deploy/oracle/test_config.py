import json
import os
from pathlib import Path
import tempfile
import unittest
from config import ConfigurationError, generate, validate
from database_identity import ensure_identity


def fixture():
    return {
        "JWT_SECRET": "test-only-signing-secret-at-least-32-characters",
        "GOOGLE_CLIENT_ID": "fixture.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "test-only-oauth-secret",
        "LLM_API_KEY": "test-only-provider-key",
        "MONGO_ROOT_USERNAME": "fixture_admin",
        "MONGO_ROOT_PASSWORD": "test-only-root-password-long-enough",
        "MONGO_APP_USERNAME": "fixture_api",
        "MONGO_APP_PASSWORD": "test-only-api-$quote'\"#:/@password",
        "MONGO_REPLICA_KEY": "aGVsbG9maXh0dXJlb25seW5vdGFyZWFsa2V5",
        "FRONTEND_URL": "https://app.example.invalid",
        "ALLOWED_ORIGINS": "https://app.example.invalid,http://tauri.localhost,https://tauri.localhost",
        "GOOGLE_CALLBACK_URL": "https://api.example.invalid/auth/google/callback",
        "PUBLIC_HEALTH_URL": "https://api.example.invalid/ready",
        "BACKEND_IMAGE": "alfred-backend:validation",
        "MONGO_IMAGE": "mongo:8.0",
        "TARGET_PLATFORM": "linux/amd64",
        "MONGO_VOLUME": "alfred_validation_mongo-data",
        "ALLOW_EMPTY_DATABASE": "false",
    }


class ConfigurationTests(unittest.TestCase):
    def test_raw_values_and_database_uri_are_preserved_without_interpolation(self):
        with tempfile.TemporaryDirectory() as directory:
            config = fixture()
            config["GOOGLE_CLIENT_SECRET"] = "a$variable${another}#quote'\""
            generate(config, Path(directory))
            backend = (Path(directory) / "backend.env").read_text(encoding="utf-8")
            self.assertIn("GOOGLE_CLIENT_SECRET=" + config["GOOGLE_CLIENT_SECRET"] + "\n", backend)
            self.assertIn("%24quote%27%22%23%3A%2F%40", backend)
            self.assertIn("MODE=production\n", backend)
            self.assertIn("authSource=alfred&replicaSet=alfred", backend)
            mongo = (Path(directory) / "mongo.env").read_text(encoding="utf-8")
            self.assertNotIn("JWT_SECRET", mongo)
            self.assertNotIn("MONGO_ROOT_PASSWORD", backend)
            if os.name != "nt":
                self.assertEqual((Path(directory) / "config.json").stat().st_mode & 0o777, 0o600)

    def test_invalid_configuration_cannot_leak_values(self):
        for field, value in (
            ("JWT_SECRET", "SECRET_SENTINEL"),
            ("GOOGLE_CALLBACK_URL", "http://localhost:8000/auth/google/callback"),
            ("ALLOWED_ORIGINS", "*"),
            ("LLM_API_KEY", "SECRET_SENTINEL\nINJECTED=yes"),
            ("TARGET_PLATFORM", "linux/386"),
            ("MONGO_VOLUME", "../unsafe"),
            ("MODE", "development"),
            ("ALLOW_EMPTY_DATABASE", "yes"),
        ):
            with self.subTest(field=field):
                config = {**fixture(), field: value}
                with self.assertRaises(ConfigurationError) as caught:
                    validate(config)
                self.assertNotIn("SECRET_SENTINEL", str(caught.exception))

    def test_public_probe_must_use_the_oauth_api_origin(self):
        with self.assertRaises(ConfigurationError):
            validate({**fixture(), "PUBLIC_HEALTH_URL": "https://another.example.invalid/ready"})

    def test_populated_unmanaged_volume_and_unapproved_empty_volume_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            baseline = Path(directory) / "database.json"
            for populated in (True, False):
                with self.assertRaises(ValueError):
                    ensure_identity(fixture(), baseline, populated)
                self.assertFalse(baseline.exists())

    def test_authorized_database_identity_survives_retry_and_rejects_rotation(self):
        with tempfile.TemporaryDirectory() as directory:
            baseline = Path(directory) / "database.json"
            config = {**fixture(), "ALLOW_EMPTY_DATABASE": "true"}
            ensure_identity(config, baseline, False)
            original = baseline.read_bytes()
            ensure_identity(config, baseline, True)
            self.assertEqual(original, baseline.read_bytes())
            for field in ("MONGO_VOLUME", "MONGO_ROOT_PASSWORD", "MONGO_APP_PASSWORD", "MONGO_REPLICA_KEY"):
                with self.subTest(field=field), self.assertRaises(ValueError):
                    ensure_identity({**config, field: "changed-sensitive-value"}, baseline, True)
            self.assertEqual(original, baseline.read_bytes())


if __name__ == "__main__":
    unittest.main()
