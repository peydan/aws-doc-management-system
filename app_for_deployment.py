import base64
import json
import os
import re
import time
import uuid
from typing import Any, Dict, List, Optional
import pandas as pd
import streamlit as st
from api_client_for_deployment import HardenedAPIClientForDeployment

# ==============================================================================
# CONFIGURATION & CONSTANTS
# ==============================================================================
st.set_page_config(
    page_title="AWS Document Management Portal [Deployment Edition]",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Enforce secure configuration from environment variables (with live AWS deployment defaults)
API_URL = os.environ.get("API_URL", "https://k0urmbeen9.execute-api.us-east-1.amazonaws.com/v1").rstrip("/")
COGNITO_CLIENT_ID = os.environ.get("COGNITO_CLIENT_ID", "3fcn104kkvrb642f33khd5c0p6")
COGNITO_USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "us-east-1_aMUcSBi6e")
COGNITO_REGION = os.environ.get("COGNITO_REGION", "us-east-1")

UUID_REGEX = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

# Custom Styling
st.markdown(
    """
    <style>
    .main-title {
        font-size: 2.0rem;
        font-weight: 700;
        color: #0F172A;
        margin-bottom: 0.2rem;
    }
    .sub-title {
        font-size: 0.95rem;
        color: #475569;
        margin-bottom: 1.5rem;
    }
    .auth-banner {
        background: linear-gradient(135deg, #1E3A8A 0%, #3B82F6 100%);
        color: white;
        padding: 24px;
        border-radius: 12px;
        margin-bottom: 24px;
    }
    .auth-banner h2 { color: white; margin: 0 0 8px 0; }
    .auth-banner p { color: #E0E7FF; margin: 0; }
    .deploy-tag {
        display: inline-block;
        background-color: #10B981;
        color: white;
        font-size: 0.75rem;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 6px;
        margin-left: 8px;
        vertical-align: middle;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


def parse_jwt_payload(token: str) -> Optional[Dict[str, Any]]:
    """Safely decodes JWT claims without executing verification (verification occurs on API Gateway)."""
    if not token or not isinstance(token, str):
        return None
    cleaned = token.replace("Bearer ", "").strip()
    parts = cleaned.split(".")
    if len(parts) != 3:
        return None
    try:
        payload_b64 = parts[1]
        payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
        decoded = base64.urlsafe_b64decode(payload_b64.encode("utf-8")).decode("utf-8")
        return json.loads(decoded)
    except Exception:
        return None


def is_valid_uuid(val: str) -> bool:
    return bool(UUID_REGEX.match(val.strip())) if val else False


# ==============================================================================
# SESSION STATE INITIALIZATION
# ==============================================================================
if "auth_token" not in st.session_state:
    st.session_state.auth_token = ""
if "user_claims" not in st.session_state:
    st.session_state.user_claims = None
if "last_doc_id" not in st.session_state:
    st.session_state.last_doc_id = ""
if "last_upload_id" not in st.session_state:
    st.session_state.last_upload_id = ""
if "last_metadata_revision" not in st.session_state:
    st.session_state.last_metadata_revision = 1

# Instantiate the Hardened API Client
client = HardenedAPIClientForDeployment(
    base_url=API_URL,
    auth_token=st.session_state.auth_token,
)


def render_response_status(status_code: int, duration_ms: float):
    if status_code in (200, 201):
        st.success(f"Status: {status_code} OK | Latency: {duration_ms} ms")
    elif status_code == 409:
        st.warning(f"Status: {status_code} CONFLICT | Latency: {duration_ms} ms")
    elif status_code == 401:
        st.error("Status: 401 UNAUTHORIZED — Session expired or invalid credentials.")
    elif status_code == 403:
        st.error("Status: 403 FORBIDDEN — Insufficient RBAC permissions.")
    elif status_code == 0:
        st.error("Network Error / Connection Blocked")
    else:
        st.error(f"Status: {status_code} ERROR | Latency: {duration_ms} ms")


def display_curl_and_json(curl_cmd: str, payload: Any):
    col1, col2 = st.tabs(["📋 Response Payload", "💻 Sanitized cURL"])
    with col1:
        st.json(payload)
    with col2:
        st.code(curl_cmd, language="bash")


# ==============================================================================
# AUTHENTICATION GATEWAY
# ==============================================================================
is_authenticated = bool(st.session_state.auth_token)

# Parse active claims if token is present
if is_authenticated:
    claims = parse_jwt_payload(st.session_state.auth_token)
    if claims:
        # Check token expiration
        exp = claims.get("exp", 0)
        if exp and exp < time.time():
            st.session_state.auth_token = ""
            st.session_state.user_claims = None
            is_authenticated = False
            st.warning("Your session has expired. Please sign in again.")
        else:
            st.session_state.user_claims = claims
    else:
        is_authenticated = False

# Sidebar Info
st.sidebar.image("https://img.icons8.com/color/96/000000/amazon-web-services.png", width=50)
st.sidebar.title("AWS Production Console")
st.sidebar.caption(f"🔒 **Edition:** `Deployable Hardened`\n\n🌐 **AWS Region:** `{COGNITO_REGION}`")

if is_authenticated and st.session_state.user_claims:
    u_claims = st.session_state.user_claims
    username = u_claims.get("cognito:username") or u_claims.get("username") or u_claims.get("email", "User")
    roles = u_claims.get("cognito:groups") or u_claims.get("roles", ["Document.Reader"])
    roles_str = ", ".join(roles) if isinstance(roles, list) else str(roles)

    st.sidebar.markdown("---")
    st.sidebar.success(f"🟢 **{username}**\n\n🛡️ Role: `{roles_str}`")

    if st.sidebar.button("🚪 Sign Out", use_container_width=True, type="secondary"):
        st.session_state.auth_token = ""
        st.session_state.user_claims = None
        st.rerun()

    st.sidebar.markdown("---")
    st.sidebar.caption(f"**API Endpoint:** `{API_URL}`")
    st.sidebar.caption(f"**Active Doc:** `{st.session_state.last_doc_id or 'None'}`")
    st.sidebar.caption(f"**Last Revision:** `{st.session_state.last_metadata_revision}`")

# ==============================================================================
# VIEW 1: LOCKED SIGN-IN SCREEN (IF NOT AUTHENTICATED)
# ==============================================================================
if not is_authenticated:
    st.markdown(
        """
        <div class="auth-banner">
            <h2>🛡️ AWS Document Management Portal <span class="deploy-tag">FOR DEPLOYMENT</span></h2>
            <p>Internet-Facing Production Access Control & Document Operations</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    col_l1, col_l2, col_l3 = st.columns([1, 2, 1])
    with col_l2:
        # Use pre-configured environment variable, or provide helpful setup input for local evaluation
        client_id_to_use = COGNITO_CLIENT_ID
        if not client_id_to_use:
            with st.expander("⚙️ Environment Setup (Missing COGNITO_CLIENT_ID)", expanded=True):
                st.info("💡 In production, `COGNITO_CLIENT_ID` is injected automatically by ECS/CDK. For local testing, enter your Client ID:")
                client_id_to_use = st.text_input("Cognito App Client ID", value="", placeholder="e.g. 2abcdef123456789...", key="local_client_id_input")

        with st.form("deploy_login_form"):
            auth_username = st.text_input("Username or Email", placeholder="user@company.com")
            auth_password = st.text_input("Password", type="password", placeholder="Enter your password")
            submit_login = st.form_submit_button("🚀 Sign In", type="primary", use_container_width=True)

            if submit_login:
                if not client_id_to_use.strip():
                    st.error("Please provide a Cognito Client ID or set the COGNITO_CLIENT_ID environment variable.")
                elif not auth_username.strip():
                    st.error("Username is required.")
                elif not auth_password:
                    st.error("Password is required.")
                else:
                    with st.spinner("Verifying credentials with AWS Cognito..."):
                        status_code, payload, duration_ms, curl_cmd = client.authenticate_cognito(
                            client_id=client_id_to_use.strip(),
                            username=auth_username.strip(),
                            password=auth_password,
                            region=COGNITO_REGION,
                        )
                    if status_code == 200 and isinstance(payload, dict) and "AuthenticationResult" in payload:
                        auth_res = payload["AuthenticationResult"]
                        id_token = auth_res.get("IdToken") or auth_res.get("AccessToken")
                        st.session_state.auth_token = id_token
                        st.success(f"Authenticated successfully ({duration_ms} ms)")
                        st.rerun()
                    else:
                        if isinstance(payload, dict):
                            err_msg = payload.get("message") or payload.get("error", {}).get("message") or payload.get("__type") or str(payload)
                            err_type = payload.get("__type") or payload.get("error", {}).get("type") or "AuthenticationError"
                        else:
                            err_msg = str(payload)
                            err_type = "AuthenticationError"
                        st.error(f"Sign-in failed [{err_type}]: {err_msg}")

    st.stop()


# ==============================================================================
# VIEW 2: AUTHENTICATED WORKSPACES
# ==============================================================================
st.markdown('<div class="main-title">AWS Document Management Portal <span class="deploy-tag">FOR DEPLOYMENT</span></div>', unsafe_allow_html=True)
st.markdown(
    '<div class="sub-title">Secure Enterprise Interface for Document Ingestion, Lineage, S3 Annotations & OpenSearch Search</div>',
    unsafe_allow_html=True,
)

u_roles = st.session_state.user_claims.get("cognito:groups", []) if st.session_state.user_claims else []
is_admin = "Document.Admin" in u_roles
is_writer = is_admin or "Document.Writer" in u_roles
is_editor = is_admin or "Document.MetadataEditor" in u_roles

# Available Tabs
tab_health, tab_search, tab_doc, tab_upload, tab_metadata, tab_admin, tab_audit = st.tabs(
    [
        "🟢 System Health",
        "🔍 Search Documents",
        "📄 Document Viewer & Lineage",
        "📤 Ingestion & Upload",
        "✏️ Metadata & Concurrency",
        "🛡️ Administrative Operations",
        "⚡ Audit Log & Inspector",
    ]
)

# ------------------------------------------------------------------------------
# TAB 1: SYSTEM HEALTH
# ------------------------------------------------------------------------------
with tab_health:
    st.header("Operational Health Check (`GET /health`)")
    if st.button("Probe Health Status", type="primary"):
        with st.spinner("Connecting to API Gateway..."):
            status_code, payload, duration_ms, curl_cmd = client.get_health()
        col1, col2, col3 = st.columns(3)
        col1.metric("Status Code", status_code)
        col2.metric("Latency", f"{duration_ms} ms")
        col3.metric("Backend Status", payload.get("status", "N/A") if isinstance(payload, dict) else "N/A")
        render_response_status(status_code, duration_ms)
        display_curl_and_json(curl_cmd, payload)

# ------------------------------------------------------------------------------
# TAB 2: SEARCH DOCUMENTS (OpenSearch)
# ------------------------------------------------------------------------------
with tab_search:
    st.header("OpenSearch Document Search (`POST /search`)")
    col_s1, col_s2, col_s3 = st.columns(3)
    with col_s1:
        s_doc_class = st.text_input("Document Class", value="loan_agreement")
        s_cust_id = st.text_input("Customer ID Filter", placeholder="e.g. IL-4492817")
    with col_s2:
        s_doc_type = st.selectbox("Document Type", ["", "SIGNED_AGREEMENT", "APPLICATION", "DISCLOSURE", "PROMISSORY_NOTE"])
        s_branch = st.text_input("Branch Code Filter", placeholder="e.g. TLV-04")
    with col_s3:
        s_loan_type = st.selectbox("Loan Type", ["", "MORTGAGE", "PERSONAL", "COMMERCIAL", "AUTO"])
        s_page_size = st.slider("Page Size", min_value=5, max_value=50, value=20)

    if st.button("Execute Search", type="primary"):
        filters = {}
        if s_doc_class.strip():
            filters["document_class"] = s_doc_class.strip()
        if s_cust_id.strip():
            filters["customer_id"] = s_cust_id.strip()
        if s_doc_type:
            filters["document_type"] = s_doc_type
        if s_branch.strip():
            filters["branch_code"] = s_branch.strip()
        if s_loan_type:
            filters["loan_type"] = s_loan_type

        with st.spinner("Querying OpenSearch index..."):
            status_code, payload, duration_ms, curl_cmd = client.search_documents(
                filters=filters,
                page_size=s_page_size,
            )
        render_response_status(status_code, duration_ms)
        display_curl_and_json(curl_cmd, payload)

        if isinstance(payload, dict) and "items" in payload:
            items = payload["items"]
            st.markdown(f"#### Results ({len(items)} found)")
            if items:
                df = pd.DataFrame(items)
                st.dataframe(df, use_container_width=True)
                doc_options = [f"{it.get('filename', 'Doc')} | ID: {it.get('document_id')}" for it in items if "document_id" in it]
                selected_doc = st.selectbox("Select document to load into viewer:", doc_options)
                if st.button("📥 Load Selected into Document Viewer"):
                    sel_id = selected_doc.split("ID: ")[-1].strip()
                    st.session_state.last_doc_id = sel_id
                    st.success(f"Selected `{sel_id}`! Navigate to the '📄 Document Viewer & Lineage' tab.")
            else:
                st.info("No documents matched the specified filters.")

# ------------------------------------------------------------------------------
# TAB 3: DOCUMENT VIEWER & LINEAGE
# ------------------------------------------------------------------------------
with tab_doc:
    st.header("Document Summary & Presigned Downloads")
    doc_id_input = st.text_input("Target Document ID (UUID)", value=st.session_state.last_doc_id)
    if doc_id_input:
        st.session_state.last_doc_id = doc_id_input.strip()

    col_dv1, col_dv2 = st.columns(2)
    with col_dv1:
        if st.button("Fetch Document Details (`GET /documents/{id}`)", type="primary"):
            if not is_valid_uuid(doc_id_input):
                st.error("Please enter a valid UUID formatted Document ID.")
            else:
                with st.spinner("Fetching document metadata..."):
                    status_code, payload, duration_ms, curl_cmd = client.get_document(doc_id_input.strip())
                render_response_status(status_code, duration_ms)
                display_curl_and_json(curl_cmd, payload)
                if isinstance(payload, dict) and "current_metadata_revision" in payload:
                    st.session_state.last_metadata_revision = payload["current_metadata_revision"]

    with col_dv2:
        if st.button("Generate Time-Limited Download Link (`GET /download`)"):
            if not is_valid_uuid(doc_id_input):
                st.error("Please enter a valid UUID formatted Document ID.")
            else:
                with st.spinner("Generating S3 presigned URL..."):
                    status_code, payload, duration_ms, curl_cmd = client.get_download_url(doc_id_input.strip())
                render_response_status(status_code, duration_ms)
                display_curl_and_json(curl_cmd, payload)
                if status_code == 200 and isinstance(payload, dict) and "download_url" in payload:
                    dl_url = payload["download_url"]
                    st.markdown(
                        f"""
                        <div style="background-color: #EFF6FF; border: 1px solid #BFDBFE; padding: 16px; border-radius: 8px; margin-top: 12px;">
                            <p style="margin: 0 0 8px 0; font-weight: 600; color: #1E40AF;">Secure S3 Presigned Download Link Generated (Expires in 15 mins):</p>
                            <a href="{dl_url}" target="_blank" style="display: inline-block; background-color: #2563EB; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 500;">💾 Download / View in Browser</a>
                        </div>
                        """,
                        unsafe_allow_html=True,
                    )

    st.markdown("---")
    st.subheader("Version History & New Version Creation")
    col_vh1, col_vh2 = st.columns(2)
    with col_vh1:
        if st.button("List Versions (`GET /versions`)"):
            if not is_valid_uuid(doc_id_input):
                st.error("Please enter a valid UUID formatted Document ID.")
            else:
                with st.spinner("Listing versions..."):
                    status_code, payload, duration_ms, curl_cmd = client.list_versions(doc_id_input.strip())
                render_response_status(status_code, duration_ms)
                display_curl_and_json(curl_cmd, payload)
                if isinstance(payload, dict) and "versions" in payload:
                    st.dataframe(pd.DataFrame(payload["versions"]), use_container_width=True)

    with col_vh2:
        if is_writer:
            new_file = st.file_uploader("Upload New Version (PDF, PNG, TXT)", type=["pdf", "png", "txt"], key="new_ver_file")
            if st.button("Commit New Version"):
                if not is_valid_uuid(doc_id_input):
                    st.error("Please enter a valid Document ID.")
                elif new_file is None:
                    st.error("Please select a file to upload.")
                else:
                    with st.spinner("Committing version..."):
                        status_code, payload, duration_ms, curl_cmd = client.create_version(
                            doc_id_input.strip(),
                            new_file.getvalue(),
                        )
                    render_response_status(status_code, duration_ms)
                    display_curl_and_json(curl_cmd, payload)
        else:
            st.info("🔒 Creating new versions requires `Document.Writer` or `Document.Admin` role.")

# ------------------------------------------------------------------------------
# TAB 4: INGESTION & UPLOAD
# ------------------------------------------------------------------------------
with tab_upload:
    st.header("Document Ingestion")
    if not is_writer:
        st.warning("🔒 Upload operations require `Document.Writer` or `Document.Admin` permissions.")
    else:
        up_file = st.file_uploader("Select File (≤ 4 MiB for Inline)", type=["pdf", "png", "tiff", "txt"])
        col_u1, col_u2 = st.columns(2)
        with col_u1:
            u_cust_id = st.text_input("Customer ID", value="IL-100293")
            u_loan_num = st.text_input("Loan Number", value="LN-2026-100")
            u_loan_amt = st.number_input("Loan Amount (Minor Units)", value=75000000)
        with col_u2:
            u_doc_type = st.selectbox("Document Type", ["SIGNED_AGREEMENT", "APPLICATION", "DISCLOSURE", "PROMISSORY_NOTE"], key="up_type")
            u_branch = st.text_input("Branch Code", value="TLV-02")
            u_loan_type = st.selectbox("Loan Type", ["MORTGAGE", "PERSONAL", "COMMERCIAL", "AUTO"], key="up_loan")

        if st.button("Submit Inline Ingestion (`POST /documents`)", type="primary"):
            if up_file is None:
                st.error("Please select a file to upload.")
            else:
                meta = {
                    "document_class": "loan_agreement",
                    "document_type": u_doc_type,
                    "customer_id": u_cust_id.strip(),
                    "loan_number": u_loan_num.strip(),
                    "loan_amount_minor_units": u_loan_amt,
                    "currency": "ILS",
                    "loan_type": u_loan_type,
                    "branch_code": u_branch.strip(),
                    "signed_date": time.strftime("%Y-%m-%d"),
                    "filename": up_file.name,
                }
                with st.spinner("Submitting document to API Gateway..."):
                    status_code, payload, duration_ms, curl_cmd = client.upload_inline_document(
                        file_bytes=up_file.getvalue(),
                        metadata=meta,
                        content_type="application/pdf" if up_file.name.endswith(".pdf") else "application/octet-stream",
                    )
                render_response_status(status_code, duration_ms)
                display_curl_and_json(curl_cmd, payload)
                if isinstance(payload, dict) and "document_id" in payload:
                    st.session_state.last_doc_id = payload["document_id"]
                    st.session_state.last_metadata_revision = payload.get("metadata_revision", 1)
                    st.success(f"Document Created! ID: `{payload['document_id']}`")

# ------------------------------------------------------------------------------
# TAB 5: METADATA & CONCURRENCY
# ------------------------------------------------------------------------------
with tab_metadata:
    st.header("Optimistic Concurrency Metadata Editor")
    if not is_editor:
        st.warning("🔒 Metadata editing requires `Document.MetadataEditor` or `Document.Admin` permissions.")
    else:
        doc_id_meta = st.text_input("Target Document ID", value=st.session_state.last_doc_id, key="meta_id")
        if st.button("Fetch Current Metadata (`GET /metadata`)"):
            if not is_valid_uuid(doc_id_meta):
                st.error("Enter a valid Document UUID.")
            else:
                with st.spinner("Fetching S3 annotation..."):
                    status_code, payload, duration_ms, curl_cmd = client.get_metadata(doc_id_meta.strip())
                render_response_status(status_code, duration_ms)
                display_curl_and_json(curl_cmd, payload)
                if isinstance(payload, dict) and "metadata_revision" in payload:
                    st.session_state.last_metadata_revision = payload["metadata_revision"]

        st.markdown("---")
        col_m1, col_m2 = st.columns(2)
        with col_m1:
            new_branch = st.text_input("New Branch Code", value="TLV-09")
            new_amt = st.number_input("New Loan Amount", value=80000000)
        with col_m2:
            exp_rev = st.number_input("Expected Revision", min_value=1, value=int(st.session_state.last_metadata_revision))
            reason = st.text_input("Update Reason", value="ANNUAL_AUDIT_CORRECTION")

        if st.button("Submit OCC Metadata Update (`PATCH`)", type="primary"):
            if not is_valid_uuid(doc_id_meta):
                st.error("Enter a valid Document UUID.")
            else:
                changes = {"branch_code": new_branch.strip(), "loan_amount_minor_units": new_amt}
                with st.spinner("Updating metadata..."):
                    status_code, payload, duration_ms, curl_cmd = client.update_metadata(
                        document_id=doc_id_meta.strip(),
                        expected_metadata_revision=exp_rev,
                        changes=changes,
                        reason=reason.strip(),
                    )
                render_response_status(status_code, duration_ms)
                display_curl_and_json(curl_cmd, payload)
                if isinstance(payload, dict) and "metadata_revision" in payload:
                    st.session_state.last_metadata_revision = payload["metadata_revision"]

# ------------------------------------------------------------------------------
# TAB 6: ADMINISTRATIVE OPERATIONS
# ------------------------------------------------------------------------------
with tab_admin:
    st.header("Document Lifecycle Administration")
    if not is_admin:
        st.warning("🔒 Lifecycle management strictly requires `Document.Admin` permissions.")
    else:
        admin_id = st.text_input("Target Document ID", value=st.session_state.last_doc_id, key="adm_id")
        col_a1, col_a2 = st.columns(2)
        with col_a1:
            st.subheader("Soft Delete")
            if st.button("Soft Delete Document (`POST /soft-delete`)", type="primary"):
                if not is_valid_uuid(admin_id):
                    st.error("Enter a valid Document UUID.")
                else:
                    with st.spinner("Soft-deleting..."):
                        status_code, payload, duration_ms, curl_cmd = client.soft_delete_document(admin_id.strip())
                    render_response_status(status_code, duration_ms)
                    display_curl_and_json(curl_cmd, payload)

        with col_a2:
            st.subheader("Restore")
            if st.button("Restore Document (`POST /restore`)"):
                if not is_valid_uuid(admin_id):
                    st.error("Enter a valid Document UUID.")
                else:
                    with st.spinner("Restoring..."):
                        status_code, payload, duration_ms, curl_cmd = client.restore_document(admin_id.strip())
                    render_response_status(status_code, duration_ms)
                    display_curl_and_json(curl_cmd, payload)

# ------------------------------------------------------------------------------
# TAB 7: AUDIT LOG & LIVE INSPECTOR
# ------------------------------------------------------------------------------
with tab_audit:
    st.header("Live Audit Log & Request Inspector")
    st.caption("All authorization tokens and passwords are automatically redacted from inspection logs.")

    if client.request_logs:
        log_df = pd.DataFrame(
            [
                {
                    "Timestamp": l["timestamp"],
                    "Method": l["method"],
                    "URL": l["url"],
                    "Status": l["status_code"],
                    "Duration (ms)": l["duration_ms"],
                }
                for l in client.request_logs
            ]
        )
        st.dataframe(log_df, use_container_width=True)
        sel_idx = st.selectbox(
            "Select request to inspect:",
            range(len(client.request_logs)),
            format_func=lambda i: f"[{client.request_logs[i]['timestamp']}] {client.request_logs[i]['method']} {client.request_logs[i]['url']} ({client.request_logs[i]['status_code']})",
        )
        selected_entry = client.request_logs[sel_idx]
        st.code(selected_entry["curl"], language="bash")
        col_p1, col_p2 = st.columns(2)
        with col_p1:
            st.markdown("**Sanitized Request Payload:**")
            st.json(selected_entry["request_payload"])
        with col_p2:
            st.markdown("**Sanitized Response Payload:**")
            st.json(selected_entry["response"])
    else:
        st.info("No requests recorded in this session yet.")
