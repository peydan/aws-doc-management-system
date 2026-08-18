import unittest
from api_client_for_deployment import HardenedAPIClientForDeployment, S3_URL_REGEX, UUID_REGEX


class TestHardenedAPIClientForDeployment(unittest.TestCase):
    def setUp(self):
        self.client = HardenedAPIClientForDeployment(
            base_url="https://a1b2c3d4e5.execute-api.us-east-1.amazonaws.com/v1",
            auth_token="sample-jwt-token-12345",
        )

    def test_insecure_http_base_url_rejected(self):
        with self.assertRaises(ValueError):
            HardenedAPIClientForDeployment(base_url="http://insecure-api-gateway.com/v1")

    def test_s3_url_whitelisting(self):
        # Valid AWS S3 URLs
        valid_s3_urls = [
            "https://mybucket.s3.amazonaws.com/documents/test.pdf?X-Amz-Signature=123",
            "https://mybucket.s3.us-east-1.amazonaws.com/documents/test.pdf",
            "https://s3.us-east-1.amazonaws.com/mybucket/documents/test.pdf",
            "https://doc-platform-storage-bucket.s3.eu-west-1.amazonaws.com/path",
        ]
        for url in valid_s3_urls:
            self.assertTrue(bool(S3_URL_REGEX.match(url)), f"Expected {url} to be valid S3 URL")

        # Invalid / SSRF target URLs (must be blocked)
        blocked_urls = [
            "http://169.254.169.254/latest/meta-data/",
            "https://169.254.169.254/latest/meta-data/",
            "http://localhost:8080/internal",
            "https://attacker-controlled-server.com/malicious.pdf",
            "https://mybucket.s3.amazonaws.com.evil.com/payload",
            "ftp://s3.amazonaws.com/file",
        ]
        for url in blocked_urls:
            self.assertFalse(bool(S3_URL_REGEX.match(url)), f"Expected {url} to be BLOCKED")

    def test_uuid_regex(self):
        valid_uuid = "740c486b-80fa-4d68-99cd-68fbfaada3c9"
        invalid_uuid = "740c486b-80fa-4d68-99cd-not-a-uuid"
        self.assertTrue(bool(UUID_REGEX.match(valid_uuid)))
        self.assertFalse(bool(UUID_REGEX.match(invalid_uuid)))

    def test_header_sanitization_and_no_mock_roles(self):
        headers = self.client._get_headers()
        self.assertEqual(headers["Authorization"], "Bearer sample-jwt-token-12345")
        self.assertNotIn("x-mock-role", headers)
        self.assertNotIn("x-mock-user", headers)

    def test_log_sanitization(self):
        sensitive_payload = {
            "password": "SuperSecretPassword123!",
            "AuthParameters": {
                "USERNAME": "admin-user",
                "PASSWORD": "SecretPassword456!",
            },
            "document_id": "740c486b-80fa-4d68-99cd-68fbfaada3c9",
        }
        sanitized = self.client._sanitize_for_logging(sensitive_payload)
        self.assertEqual(sanitized["password"], "[REDACTED]")
        self.assertEqual(sanitized["AuthParameters"]["PASSWORD"], "[REDACTED]")
        self.assertEqual(sanitized["document_id"], "740c486b-80fa-4d68-99cd-68fbfaada3c9")


if __name__ == "__main__":
    unittest.main()
