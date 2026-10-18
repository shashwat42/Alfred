import json
import os
from pathlib import Path
import tempfile
import unittest
from config import ConfigurationError, generate, validate


def fixture():
    return {
        "JWT_SECRET": "test-only-signing-secret-at-least-32-characters",
        "GOOGLE_CLIENT_ID": "fixture.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "test-only-oauth-secret",
        "LLM_API_KEY": "test-only-provider-key",
        "MONGODB_URI": "mongodb+srv://fixture_api:test%24%27%22%23%3A%2F%40@fixture.mongodb.net/alfred?retryWrites=true&w=majority&authSource=admin",
        "FRONTEND_URL": "https://app.example.invalid",
        "ALLOWED_ORIGINS": "https://app.example.invalid,http://tauri.localhost,https://tauri.localhost",
        "GOOGLE_CALLBACK_URL": "https://api.example.invalid/auth/google/callback",
        "PUBLIC_HEALTH_URL": "https://api.example.invalid/ready",
        "BACKEND_IMAGE": "alfred-backend:validation",
        "TARGET_PLATFORM": "linux/amd64",
    }


class ConfigurationTests(unittest.TestCase):
    def test_raw_values_and_database_uri_are_preserved_without_interpolation(self):
        with tempfile.TemporaryDirectory() as directory:
            config = fixture()
            config["GOOGLE_CLIENT_SECRET"] = "a$variable${another}#quote'\""
            generate(config, Path(directory))
            backend = (Path(directory) / "backend.env").read_text(encoding="utf-8")
            self.assertIn("GOOGLE_CLIENT_SECRET=" + config["GOOGLE_CLIENT_SECRET"] + "\n", backend)
            self.assertIn("MONGODB_URI=" + config["MONGODB_URI"] + "\n", backend)
            self.assertIn("MODE=production\n", backend)
            self.assertIn("authSource=admin", backend)
            self.assertFalse((Path(directory) / "mongo.env").exists())
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
            ("MONGODB_DNS_SERVERS", "invalid"),
            ("MODE", "development"),
            ("MONGO_VOLUME", "unsupported-old-config"),
        ):
            with self.subTest(field=field):
                config = {**fixture(), field: value}
                with self.assertRaises(ConfigurationError) as caught:
                    validate(config)
                self.assertNotIn("SECRET_SENTINEL", str(caught.exception))

    def test_public_probe_must_use_the_oauth_api_origin(self):
        with self.assertRaises(ConfigurationError):
            validate({**fixture(), "PUBLIC_HEALTH_URL": "https://another.example.invalid/ready"})

    def test_atlas_uri_rejects_wrong_database_and_insecure_tls(self):
        for uri in (
            "mongodb://user:password@localhost/alfred",
            "mongodb+srv://user:password@fixture.mongodb.net/wrong",
            "mongodb+srv://user:password@fixture.mongodb.net/alfred?tls=false",
            "mongodb+srv://user:password@fixture.mongodb.net/alfred?tlsAllowInvalidCertificates=true",
            "mongodb+srv://user:password@fixture.mongodb.net/alfred?authSource=alfred",
        ):
            with self.subTest(uri=uri), self.assertRaises(ConfigurationError):
                validate({**fixture(), "MONGODB_URI": uri})

    def test_optional_dns_override_is_private_runtime_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            generate({**fixture(), "MONGODB_DNS_SERVERS": "1.1.1.1,8.8.8.8"}, Path(directory))
            backend = (Path(directory) / "backend.env").read_text(encoding="utf-8")
            deploy = (Path(directory) / "deploy.env").read_text(encoding="utf-8")
            self.assertIn("MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8", backend)
            self.assertNotIn("MONGODB_URI", deploy)
            self.assertNotIn("ALFRED_MONGO", deploy)


if __name__ == "__main__":
    unittest.main()
