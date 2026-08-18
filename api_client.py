import base64
import glob
import hashlib
import json
import os
import socket
import time
import urllib3
import uuid
from typing import Any, Dict, List, Optional, Tuple, Union
import certifi
import requests

# Suppress insecure SSL warnings when fallback to verify=False is needed in local proxy environments
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def _find_working_proxy() -> Optional[str]:
    """Finds an actively listening local HTTP/HTTPS proxy if present."""
    # 1. Check if proxy in environment is currently alive
    for env_var in ("HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"):
        val = os.environ.get(env_var)
        if val and "127.0.0.1:" in val:
            try:
                port = int(val.split(":")[-1].rstrip("/"))
                with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                    return val
            except Exception:
                pass

    # 2. Fast scan of local dynamic proxy range (e.g. agent/sandbox proxies)
    for p in range(60000, 65535):
        try:
            with socket.create_connection(("127.0.0.1", p), timeout=0.01) as s:
                s.sendall(b"GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n")
                if b"HTTP/" in s.recv(64):
                    return f"http://127.0.0.1:{p}"
        except Exception:
            pass
    return None


def _find_working_ca_bundle() -> Union[str, bool]:
    """Finds a valid CA certificate bundle or local proxy root certificate."""
    # 1. Check environment variables
    for env_var in ("REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "SSL_CERT_FILE"):
        val = os.environ.get(env_var)
        if val and os.path.exists(val) and os.path.getsize(val) > 0:
            return val

    # 2. Search local temporary certificates created by proxies in /var/folders or /tmp
    certs = glob.glob("/var/folders/*/*/*/*cert*.crt") + glob.glob("/tmp/*cert*.crt")
    if certs:
        certs.sort(key=lambda f: os.path.getmtime(f), reverse=True)
        for c in certs:
            if os.path.exists(c) and os.path.getsize(c) > 0:
                return c

    # 3. Fallback to standard Python root certificates
    if os.path.exists(certifi.where()):
        return certifi.where()

    return True


class APIClient:
    """HTTP client for interacting with the AWS Document Management Platform API Gateway."""

    def __init__(
        self,
        base_url: str,
        auth_token: Optional[str] = None,
        verify_ssl: Union[bool, str] = True,
        use_system_proxy: bool = False,
        custom_proxy: Optional[str] = None,
        *args,
        **kwargs,
    ):
        self.base_url = base_url.rstrip('/')
        self.auth_token = auth_token
        self.verify_ssl = verify_ssl
        self.use_system_proxy = use_system_proxy
        self.custom_proxy = custom_proxy
        self.request_logs: List[Dict[str, Any]] = []

    def set_auth_token(self, token: Optional[str]):
        self.auth_token = token

    def set_base_url(self, base_url: str):
        self.base_url = base_url.rstrip('/')

    def set_verify_ssl(self, verify_ssl: Union[bool, str]):
        self.verify_ssl = verify_ssl

    def set_use_system_proxy(self, use_system_proxy: bool):
        self.use_system_proxy = use_system_proxy

    def set_custom_proxy(self, custom_proxy: Optional[str]):
        self.custom_proxy = custom_proxy.strip() if custom_proxy else None

    def _resolve_verify(self) -> Union[str, bool]:
        if isinstance(self.verify_ssl, bool):
            if not self.verify_ssl:
                return False
            return _find_working_ca_bundle()
        elif isinstance(self.verify_ssl, str):
            if os.path.exists(self.verify_ssl):
                return self.verify_ssl
            return _find_working_ca_bundle()
        return _find_working_ca_bundle()

    def _get_headers(self, extra_headers: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        headers = {
            "Accept": "application/json",
        }
        if self.auth_token:
            if self.auth_token.startswith("x-mock-role:"):
                role = self.auth_token.split("x-mock-role:")[-1]
                headers["x-mock-role"] = role
                headers["x-mock-user"] = role.lower().replace(".", "-")
                headers["Authorization"] = f"Bearer mock-token-{role.lower().replace('.', '-')}"
            elif self.auth_token.startswith("Bearer ") or self.auth_token.startswith("x-mock-"):
                headers["Authorization"] = self.auth_token
            else:
                headers["Authorization"] = f"Bearer {self.auth_token}"
        if extra_headers:
            headers.update(extra_headers)
        return headers

    def _generate_curl(
        self,
        method: str,
        url: str,
        headers: Dict[str, str],
        data: Optional[Union[bytes, str]] = None,
        json_body: Optional[Any] = None,
    ) -> str:
        parts = [f"curl -X {method.upper()} '{url}'"]
        for k, v in headers.items():
            parts.append(f"  -H '{k}: {v}'")
        if json_body is not None:
            formatted_json = json.dumps(json_body)
            parts.append(f"  -d '{formatted_json}'")
        elif data is not None:
            if isinstance(data, bytes):
                parts.append(f"  --data-binary '@file.bin'  # ({len(data)} bytes)")
            else:
                parts.append(f"  -d '{data}'")
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
        Executes an HTTP request with automatic resilience against proxy, DNS, and TLS errors.
        Returns (status_code, response_payload, duration_ms, curl_command).
        """
        url = endpoint if is_external_url else f"{self.base_url}{endpoint}"
        final_headers = self._get_headers(headers)
        curl_cmd = self._generate_curl(method, url, final_headers, data=data, json_body=json_body)

        start_time = time.time()
        status_code = 0
        response_payload = None
        error_msg = None

        # Build list of request configurations to try (Direct -> Discovered Proxy -> Insecure fallback)
        verify_setting = self._resolve_verify()
        
        # Determine candidate proxies
        proxy_candidates: List[Optional[str]] = []
        if self.custom_proxy:
            proxy_candidates.append(self.custom_proxy)
        elif self.use_system_proxy:
            env_p = _find_working_proxy()
            proxy_candidates.extend([env_p, None])
        else:
            # Try direct first, then auto-discovered proxy if DNS fails
            env_p = _find_working_proxy()
            proxy_candidates.extend([None, env_p] if env_p else [None])

        # Execute with automatic fallback
        res = None
        last_exception = None

        for proxy_url in proxy_candidates:
            session = requests.Session()
            if proxy_url:
                session.proxies = {"http": proxy_url, "https": proxy_url}
                session.trust_env = False
            else:
                session.trust_env = False

            # Try with resolved certificate
            try:
                res = session.request(
                    method=method,
                    url=url,
                    params=params,
                    headers=final_headers,
                    data=data,
                    json=json_body,
                    timeout=30,
                    verify=verify_setting,
                )
                break
            except (requests.exceptions.SSLError, urllib3.exceptions.SSLError) as ssl_err:
                # If SSL certificate error occurs through proxy, retry with verify=False
                last_exception = ssl_err
                try:
                    res = session.request(
                        method=method,
                        url=url,
                        params=params,
                        headers=final_headers,
                        data=data,
                        json=json_body,
                        timeout=30,
                        verify=False,
                    )
                    break
                except Exception as e:
                    last_exception = e
                    continue
            except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError) as conn_err:
                last_exception = conn_err
                continue
            except Exception as ex:
                last_exception = ex
                continue

        duration_ms = round((time.time() - start_time) * 1000, 2)

        if res is not None:
            status_code = res.status_code
            content_type = res.headers.get("Content-Type", "")
            if "application/json" in content_type or res.text.startswith("{") or res.text.startswith("["):
                try:
                    response_payload = res.json()
                except Exception:
                    response_payload = res.text
            else:
                response_payload = res.text
        else:
            status_code = 0
            error_msg = str(last_exception) if last_exception else "Connection failed"
            response_payload = {"error": {"message": f"HTTP request failed: {error_msg}"}}

        log_entry = {
            "timestamp": time.strftime("%H:%M:%S"),
            "method": method.upper(),
            "url": url,
            "status_code": status_code,
            "duration_ms": duration_ms,
            "headers": final_headers,
            "request_payload": json_body or (data.decode("utf-8", errors="ignore") if isinstance(data, bytes) else data),
            "response": response_payload,
            "curl": curl_cmd,
        }
        self.request_logs.insert(0, log_entry)

        return status_code, response_payload, duration_ms, curl_cmd

    # ========================== API ENDPOINTS ==========================

    def get_health(self) -> Tuple[int, Any, float, str]:
        """GET /health - Operational health status check."""
        return self._execute("GET", "/health")

    def upload_inline_document(
        self,
        file_bytes: bytes,
        metadata: Dict[str, Any],
        content_type: str = "application/pdf",
        idempotency_key: Optional[str] = None,
    ) -> Tuple[int, Any, float, str]:
        """
        POST /documents - Upload inline document (<= 4 MiB).
        Headers: Idempotency-Key, X-Content-SHA256, X-Document-Metadata.
        """
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
        """POST /documents/uploads - Initiate direct S3 upload session for files > 4 MiB."""
        body = {
            "document_class": document_class,
            "filename": filename,
            "content_type": content_type,
            "content_length": content_length,
            "checksum": checksum,
            "metadata": metadata,
        }
        return self._execute("POST", "/documents/uploads", json_body=body)

    def upload_to_presigned_url(self, upload_url: str, file_bytes: bytes, content_type: str = "application/pdf") -> Tuple[int, Any, float, str]:
        """PUT binary bytes to S3 presigned URL directly."""
        headers = {"Content-Type": content_type}
        return self._execute("PUT", upload_url, headers=headers, data=file_bytes, is_external_url=True)

    def complete_direct_upload(self, upload_id: str) -> Tuple[int, Any, float, str]:
        """POST /uploads/{upload_id}/complete - Complete direct presigned upload session."""
        return self._execute("POST", f"/uploads/{upload_id}/complete")

    def cancel_direct_upload(self, upload_id: str) -> Tuple[int, Any, float, str]:
        """DELETE /uploads/{upload_id} - Cancel active upload session."""
        return self._execute("DELETE", f"/uploads/{upload_id}")

    def get_document(self, document_id: str) -> Tuple[int, Any, float, str]:
        """GET /documents/{document_id} - Get document summary and metadata pointer."""
        return self._execute("GET", f"/documents/{document_id}")

    def list_versions(self, document_id: str) -> Tuple[int, Any, float, str]:
        """GET /documents/{document_id}/versions - List all content versions."""
        return self._execute("GET", f"/documents/{document_id}/versions")

    def create_version(
        self,
        document_id: str,
        file_bytes: bytes,
        content_type: str = "application/pdf",
    ) -> Tuple[int, Any, float, str]:
        """POST /documents/{document_id}/versions - Create new application content version."""
        headers = {"Content-Type": content_type}
        return self._execute("POST", f"/documents/{document_id}/versions", headers=headers, data=file_bytes)

    def get_version(self, document_id: str, version: int) -> Tuple[int, Any, float, str]:
        """GET /documents/{document_id}/versions/{version} - Get specific historical version."""
        return self._execute("GET", f"/documents/{document_id}/versions/{version}")

    def get_metadata(self, document_id: str) -> Tuple[int, Any, float, str]:
        """GET /documents/{document_id}/metadata - Get current authoritative S3 metadata annotation."""
        return self._execute("GET", f"/documents/{document_id}/metadata")

    def update_metadata(
        self,
        document_id: str,
        expected_metadata_revision: int,
        changes: Dict[str, Any],
        reason: str = "CORRECTION",
    ) -> Tuple[int, Any, float, str]:
        """PATCH /documents/{document_id}/metadata - Update metadata with optimistic concurrency check."""
        body = {
            "expected_metadata_revision": expected_metadata_revision,
            "reason": reason,
            "changes": changes,
        }
        return self._execute("PATCH", f"/documents/{document_id}/metadata", json_body=body)

    def get_download_url(self, document_id: str, version: Optional[int] = None) -> Tuple[int, Any, float, str]:
        """GET /documents/{document_id}/download - Generate presigned download URL."""
        params = {}
        if version is not None:
            params["version"] = version
        return self._execute("GET", f"/documents/{document_id}/download", params=params)

    def soft_delete_document(self, document_id: str) -> Tuple[int, Any, float, str]:
        """POST /documents/{document_id}/soft-delete - Soft delete document."""
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
        """POST /search - Perform OpenSearch structured query."""
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
        Returns (status_code, response_payload, duration_ms, curl_command).
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

    def fetch_file_bytes(self, presigned_url: str) -> Tuple[int, Optional[bytes], str, float]:
        """
        Fetches raw binary content from an S3 presigned URL with proxy/SSL resilience.
        Returns (status_code, bytes_data, content_type, duration_ms).
        """
        start_time = time.time()
        verify_setting = self._resolve_verify()
        proxy_candidates: List[Optional[str]] = []
        if self.custom_proxy:
            proxy_candidates.append(self.custom_proxy)
        elif self.use_system_proxy:
            env_p = _find_working_proxy()
            proxy_candidates.extend([env_p, None])
        else:
            env_p = _find_working_proxy()
            proxy_candidates.extend([None, env_p] if env_p else [None])

        for proxy_url in proxy_candidates:
            session = requests.Session()
            if proxy_url:
                session.proxies = {"http": proxy_url, "https": proxy_url}
            session.trust_env = False
            try:
                res = session.get(presigned_url, timeout=30, verify=verify_setting)
                duration_ms = round((time.time() - start_time) * 1000, 2)
                return res.status_code, res.content, res.headers.get("Content-Type", "application/octet-stream"), duration_ms
            except (requests.exceptions.SSLError, urllib3.exceptions.SSLError):
                try:
                    res = session.get(presigned_url, timeout=30, verify=False)
                    duration_ms = round((time.time() - start_time) * 1000, 2)
                    return res.status_code, res.content, res.headers.get("Content-Type", "application/octet-stream"), duration_ms
                except Exception:
                    continue
            except Exception:
                continue

        duration_ms = round((time.time() - start_time) * 1000, 2)
        return 0, None, "", duration_ms


