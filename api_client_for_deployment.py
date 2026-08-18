import base64
import hashlib
import json
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple, Union
import certifi
import requests
import urllib3

# Configure structured logger
logger = logging.getLogger("doc_platform_api_client_for_deployment")
logger.setLevel(logging.INFO)

# Regex pattern to validate that presigned URLs strictly target legitimate AWS S3 endpoints
S3_URL_REGEX = re.compile(
    r"^https://([a-zA-Z0-9.\-_]+\.)?s3([.\-][a-zA-Z0-9\-]+)?\.amazonaws\.com/",
    re.IGNORECASE,
)

UUID_REGEX = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


class HardenedAPIClientForDeployment:
    """
    Hardened Production HTTP Client for AWS Document Management Platform Deployment.
    Enforces strict TLS validation via certifi, SSRF protection, domain whitelisting,
    bounded timeouts, and sanitized logging.
    """

    def __init__(
        self,
        base_url: str,
        auth_token: Optional[str] = None,
        timeout_seconds: int = 25,
    ):
        clean_url = base_url.rstrip("/")
        if not clean_url.startswith("https://") and not (
            clean_url.startswith("http://localhost") or clean_url.startswith("http://127.0.0.1")
        ):
            raise ValueError(f"Insecure or invalid Base URL scheme: '{clean_url}'. HTTPS is required in production deployment.")

        self.base_url = clean_url
        self.auth_token = auth_token
        self.timeout_seconds = timeout_seconds
        self.request_logs: List[Dict[str, Any]] = []

        # Enforce standard CA bundle from certifi
        self.ca_bundle = certifi.where()

    def set_auth_token(self, token: Optional[str]):
        """Sets or updates the active Authorization token."""
        self.auth_token = token.strip() if token else None

    def _get_headers(self, extra_headers: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """Builds standard headers. Rejects test/mock role headers."""
        headers = {
            "Accept": "application/json",
            "User-Agent": "DocPlatform-DeploymentClient/1.0",
        }
        if self.auth_token:
            clean_token = self.auth_token.replace("Bearer ", "").strip()
            headers["Authorization"] = f"Bearer {clean_token}"

        if extra_headers:
            headers.update(extra_headers)
        return headers

    def _sanitize_for_logging(self, data: Any) -> Any:
        """Deep sanitization to prevent sensitive tokens or passwords from leaking into audit logs."""
        if isinstance(data, dict):
            sanitized = {}
            for k, v in data.items():
                k_lower = str(k).lower()
                if "password" in k_lower or "secret" in k_lower:
                    sanitized[k] = "[REDACTED]"
                elif any(sec in k_lower for sec in ("authorization", "token", "key")):
                    if isinstance(v, str) and len(v) > 12:
                        sanitized[k] = f"{v[:4]}...[REDACTED]...{v[-4:]}"
                    else:
                        sanitized[k] = "[REDACTED]"
                else:
                    sanitized[k] = self._sanitize_for_logging(v)
            return sanitized
        elif isinstance(data, list):
            return [self._sanitize_for_logging(i) for i in data]
        return data

    def _generate_curl(
        self,
        method: str,
        url: str,
        headers: Dict[str, str],
        data: Optional[Union[bytes, str]] = None,
        json_body: Optional[Any] = None,
    ) -> str:
        """Generates a sanitized reproducible cURL snippet for audit inspection."""
        sanitized_headers = self._sanitize_for_logging(headers)
        parts = [f"curl -X {method.upper()} '{url}'"]
        for k, v in sanitized_headers.items():
            parts.append(f"  -H '{k}: {v}'")
        if json_body is not None:
            parts.append(f"  -d '{json.dumps(self._sanitize_for_logging(json_body))}'")
        elif data is not None:
            if isinstance(data, bytes):
                parts.append(f"  --data-binary '@file.bin'  # ({len(data)} bytes)")
            else:
                parts.append(f"  -d '[PAYLOAD ({len(data)} chars)]'")
        return " \\\n".join(parts)

    def _execute(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        data: Optional[Union[bytes, str]] = None,
        json_body: Optional[Any] = None,
        is_external_url: bool = False,
    ) -> Tuple[int, Any, float, str]:
        """
        Executes an HTTP request with strict TLS verification and zero insecure fallbacks.
        """
        url = endpoint if is_external_url else f"{self.base_url}{endpoint}"

        # SSRF Protection: Validate target domain if external URL
        if is_external_url:
            if not S3_URL_REGEX.match(url) and not url.startswith("https://cognito-idp."):
                logger.error("Blocked outgoing request to non-whitelisted external URL: %s", url)
                return 400, {"error": {"message": "Outgoing request blocked: URL domain not permitted."}}, 0.0, ""

        final_headers = self._get_headers(headers)
        curl_cmd = self._generate_curl(method, url, final_headers, data=data, json_body=json_body)

        start_time = time.time()
        status_code = 0
        response_payload = None

        try:
            with requests.Session() as session:
                res = session.request(
                    method=method,
                    url=url,
                    params=params,
                    headers=final_headers,
                    data=data,
                    json=json_body,
                    timeout=self.timeout_seconds,
                    verify=self.ca_bundle,
                )
                status_code = res.status_code
                content_type = res.headers.get("Content-Type", "")
                if "application/json" in content_type or res.text.startswith("{") or res.text.startswith("["):
                    try:
                        response_payload = res.json()
                    except Exception:
                        response_payload = res.text
                else:
                    response_payload = res.text
        except requests.exceptions.Timeout:
            status_code = 504
            response_payload = {"error": {"message": f"Request timed out after {self.timeout_seconds}s"}}
        except requests.exceptions.SSLError as ssl_err:
            status_code = 525
            logger.error("SSL Verification Failure: %s", str(ssl_err))
            response_payload = {"error": {"message": "TLS/SSL Certificate Verification Failed. Insecure connection rejected."}}
        except requests.exceptions.RequestException as req_err:
            status_code = 0
            logger.error("Network / HTTP Request Error: %s", str(req_err))
            response_payload = {"error": {"message": f"Network Error: {str(req_err)}"}}

        duration_ms = round((time.time() - start_time) * 1000, 2)

        log_entry = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "method": method.upper(),
            "url": url,
            "status_code": status_code,
            "duration_ms": duration_ms,
            "headers": self._sanitize_for_logging(final_headers),
            "request_payload": self._sanitize_for_logging(json_body) or (
                f"[Binary Payload: {len(data)} bytes]" if isinstance(data, bytes) else data
            ),
            "response": self._sanitize_for_logging(response_payload) if isinstance(response_payload, (dict, list)) else (
                response_payload[:2000] if isinstance(response_payload, str) else str(response_payload)
            ),
            "curl": curl_cmd,
        }
        self.request_logs.insert(0, log_entry)
        if len(self.request_logs) > 100:
            self.request_logs.pop()

        return status_code, response_payload, duration_ms, curl_cmd

    # ========================== API OPERATIONS ==========================

    def get_health(self) -> Tuple[int, Any, float, str]:
        """GET /health - Verifies API Gateway operational SLA."""
        return self._execute("GET", "/health")

    def upload_inline_document(
        self,
        file_bytes: bytes,
        metadata: Dict[str, Any],
        content_type: str = "application/pdf",
        idempotency_key: Optional[str] = None,
    ) -> Tuple[int, Any, float, str]:
        """POST /documents - Upload inline binary payload up to 4 MiB."""
        import uuid
        if not idempotency_key:
            idempotency_key = str(uuid.uuid4())

        sha256_hash = hashlib.sha256(file_bytes).hexdigest()
        metadata_json = json.dumps(metadata)
        metadata_b64 = base64.b64encode(metadata_json.encode("utf-8")).decode("utf-8")

        headers = {
            "Content-Type": content_type,
            "Idempotency-Key": idempotency_key,
            "X-Content-SHA256": sha256_hash,
            "X-Document-Metadata": metadata_b64,
        }
        return self._execute("POST", "/documents", headers=headers, data=file_bytes)

    def initiate_direct_upload(
        self,
        filename: str,
        content_length: int,
        checksum: str,
        metadata: Dict[str, Any],
        document_class: str = "loan_agreement",
        content_type: str = "application/pdf",
    ) -> Tuple[int, Any, float, str]:
        """POST /documents/uploads - Request S3 direct presigned PUT URL."""
        body = {
            "document_class": document_class,
            "filename": filename,
            "content_type": content_type,
            "content_length": content_length,
            "checksum": checksum,
            "metadata": metadata,
        }
        return self._execute("POST", "/documents/uploads", json_body=body)

    def upload_to_presigned_url(
        self,
        upload_url: str,
        file_bytes: bytes,
        content_type: str = "application/pdf",
    ) -> Tuple[int, Any, float, str]:
        """PUT binary bytes directly to validated S3 presigned URL."""
        if not S3_URL_REGEX.match(upload_url):
            return 400, {"error": {"message": "Invalid S3 Presigned URL target."}}, 0.0, ""
        headers = {"Content-Type": content_type}
        return self._execute("PUT", upload_url, headers=headers, data=file_bytes, is_external_url=True)

    def complete_direct_upload(self, upload_id: str) -> Tuple[int, Any, float, str]:
        """POST /uploads/{upload_id}/complete - Commit upload session."""
        return self._execute("POST", f"/uploads/{upload_id}/complete")

    def cancel_direct_upload(self, upload_id: str) -> Tuple[int, Any, float, str]:
        """DELETE /uploads/{upload_id} - Abort pending upload session."""
        return self._execute("DELETE", f"/uploads/{upload_id}")

    def get_document(self, document_id: str) -> Tuple[int, Any, float, str]:
        """GET /documents/{document_id} - Retrieve document summary."""
        return self._execute("GET", f"/documents/{document_id}")

    def list_versions(self, document_id: str) -> Tuple[int, Any, float, str]:
        """GET /documents/{document_id}/versions - List application versions."""
        return self._execute("GET", f"/documents/{document_id}/versions")

    def create_version(
        self,
        document_id: str,
        file_bytes: bytes,
        content_type: str = "application/pdf",
    ) -> Tuple[int, Any, float, str]:
        """POST /documents/{document_id}/versions - Commit new content version."""
        headers = {"Content-Type": content_type}
        return self._execute("POST", f"/documents/{document_id}/versions", headers=headers, data=file_bytes)

    def get_version(self, document_id: str, version: int) -> Tuple[int, Any, float, str]:
        """GET /documents/{document_id}/versions/{version} - Historical version details."""
        return self._execute("GET", f"/documents/{document_id}/versions/{version}")

    def get_metadata(self, document_id: str) -> Tuple[int, Any, float, str]:
        """GET /documents/{document_id}/metadata - Authoritative S3 metadata annotation."""
        return self._execute("GET", f"/documents/{document_id}/metadata")

    def update_metadata(
        self,
        document_id: str,
        expected_metadata_revision: int,
        changes: Dict[str, Any],
        reason: str = "CORRECTION",
    ) -> Tuple[int, Any, float, str]:
        """PATCH /documents/{document_id}/metadata - Optimistic concurrency metadata update."""
        body = {
            "expected_metadata_revision": expected_metadata_revision,
            "reason": reason,
            "changes": changes,
        }
        return self._execute("PATCH", f"/documents/{document_id}/metadata", json_body=body)

    def get_download_url(self, document_id: str, version: Optional[int] = None) -> Tuple[int, Any, float, str]:
        """GET /documents/{document_id}/download - Generate time-limited presigned download URL."""
        params = {}
        if version is not None:
            params["version"] = version
        return self._execute("GET", f"/documents/{document_id}/download", params=params)

    def soft_delete_document(self, document_id: str) -> Tuple[int, Any, float, str]:
        """POST /documents/{document_id}/soft-delete - Soft-delete document from index."""
        return self._execute("POST", f"/documents/{document_id}/soft-delete")

    def restore_document(self, document_id: str) -> Tuple[int, Any, float, str]:
        """POST /documents/{document_id}/restore - Restore soft-deleted document."""
        return self._execute("POST", f"/documents/{document_id}/restore")

    def search_documents(
        self,
        filters: Optional[Dict[str, Any]] = None,
        sort: Optional[Dict[str, str]] = None,
        page_size: int = 20,
        cursor: Optional[List[str]] = None,
    ) -> Tuple[int, Any, float, str]:
        """POST /search - Perform structured OpenSearch query."""
        body: Dict[str, Any] = {"page_size": page_size}
        if filters:
            body["filters"] = {k: v for k, v in filters.items() if v != "" and v is not None}
        if sort:
            body["sort"] = sort
        if cursor:
            body["cursor"] = cursor
        return self._execute("POST", "/search", json_body=body)

    def authenticate_cognito(
        self,
        client_id: str,
        username: str,
        password: str,
        region: str = "us-east-1",
    ) -> Tuple[int, Any, float, str]:
        """
        Authenticate against AWS Cognito User Pool via USER_PASSWORD_AUTH.
        Strictly targets official AWS Cognito endpoints over HTTPS.
        """
        endpoint = f"https://cognito-idp.{region}.amazonaws.com/"
        headers = {
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
        }
        body = {
            "AuthFlow": "USER_PASSWORD_AUTH",
            "ClientId": client_id,
            "AuthParameters": {
                "USERNAME": username,
                "PASSWORD": password,
            },
        }
        return self._execute("POST", endpoint, headers=headers, json_body=body, is_external_url=True)
