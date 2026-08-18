import base64
import importlib
import json
import time
import uuid
from typing import Any, Dict, List, Optional
import pandas as pd
import streamlit as st
import api_client
importlib.reload(api_client)
from api_client import APIClient

st.set_page_config(
    page_title="AWS Document Management Platform",
    page_icon="📄",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Custom Styling
st.markdown(
    """
    <style>
    .main-title {
        font-size: 2.2rem;
        font-weight: 700;
        color: #1E293B;
        margin-bottom: 0.2rem;
    }
    .sub-title {
        font-size: 1.0rem;
        color: #64748B;
        margin-bottom: 1.5rem;
    }
    .status-badge {
        padding: 4px 10px;
        border-radius: 12px;
        font-weight: 600;
        font-size: 0.85rem;
    }
    .badge-active { background-color: #DEF7EC; color: #03543F; }
    .badge-deleted { background-color: #FDE8E8; color: #9B1C1C; }
    .badge-200 { background-color: #DEF7EC; color: #03543F; }
    .badge-201 { background-color: #E1EFFE; color: #1E429F; }
    .badge-409 { background-color: #FEECDC; color: #B45309; }
    .badge-error { background-color: #FDE8E8; color: #9B1C1C; }
    .metric-card {
        background-color: #F8FAFC;
        border: 1px solid #E2E8F0;
        border-radius: 8px;
        padding: 16px;
        text-align: center;
    }
    .stButton>button {
        border-radius: 6px;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

# Helper function to decode and inspect JWT claims safely without external deps
def parse_jwt_payload(token: str) -> Optional[Dict[str, Any]]:
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

# Initialize Session State
DEFAULT_API_URL = os.environ.get("API_URL", "https://your-api-id.execute-api.us-east-1.amazonaws.com/v1")
DEFAULT_COGNITO_CLIENT_ID = os.environ.get("COGNITO_CLIENT_ID", "")
DEFAULT_COGNITO_USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "")

if "api_url" not in st.session_state or st.session_state.api_url == "https://doc-platform-api.execute-api.us-east-1.amazonaws.com/v1":
    st.session_state.api_url = DEFAULT_API_URL
if "auth_token" not in st.session_state:
    st.session_state.auth_token = ""
if "cognito_client_id" not in st.session_state or not st.session_state.cognito_client_id:
    st.session_state.cognito_client_id = DEFAULT_COGNITO_CLIENT_ID
if "cognito_region" not in st.session_state:
    st.session_state.cognito_region = "us-east-1"
if "cognito_username" not in st.session_state:
    st.session_state.cognito_username = "admin-user"
if "cognito_password" not in st.session_state or not st.session_state.cognito_password:
    st.session_state.cognito_password = os.environ.get("COGNITO_PASSWORD", "")
if "verify_ssl" not in st.session_state:
    st.session_state.verify_ssl = True
if "use_system_proxy" not in st.session_state:
    st.session_state.use_system_proxy = False
if "custom_proxy" not in st.session_state:
    st.session_state.custom_proxy = ""
if "request_logs" not in st.session_state:
    st.session_state.request_logs = []

if "last_doc_id" not in st.session_state:
    st.session_state.last_doc_id = ""
if "last_upload_id" not in st.session_state:
    st.session_state.last_upload_id = ""
if "last_presigned_url" not in st.session_state:
    st.session_state.last_presigned_url = ""
if "last_metadata_revision" not in st.session_state:
    st.session_state.last_metadata_revision = 1
if "preview_doc" not in st.session_state:
    st.session_state.preview_doc = None


def render_response_status(status_code: int, duration_ms: float):
    if status_code in (200, 201):
        st.success(f"Status: {status_code} OK | Time: {duration_ms} ms")
    elif status_code == 409:
        st.warning(f"Status: {status_code} CONFLICT | Time: {duration_ms} ms")
    elif status_code == 0:
        st.error("Request Failed / Network Error")
    else:
        st.error(f"Status: {status_code} ERROR | Time: {duration_ms} ms")


def display_curl_and_json(curl_cmd: str, payload: Any):
    col1, col2 = st.tabs(["📋 Response Payload", "💻 cURL Command"])
    with col1:
        st.json(payload)
    with col2:
        st.code(curl_cmd, language="bash")


def render_embedded_document_viewer(
    file_bytes: bytes,
    filename: str,
    content_type: str,
    document_id: str,
    version_num: Optional[int] = None,
):
    st.markdown("---")
    st.markdown(f"#### 📄 Document Preview: `{filename}`")

    col_info1, col_info2, col_info3 = st.columns(3)
    with col_info1:
        st.caption(f"**Document ID:** `{document_id}`")
    with col_info2:
        st.caption(f"**Content Type:** `{content_type}`")
    with col_info3:
        st.caption(f"**Size:** `{len(file_bytes):,} bytes` | **Version:** `{version_num or 'Current'}`")

    st.download_button(
        label=f"💾 Download {filename}",
        data=file_bytes,
        file_name=filename,
        mime=content_type or "application/octet-stream",
        key=f"dl_btn_{document_id}_{version_num or 'cur'}",
        type="secondary",
    )

    fn_lower = filename.lower()
    ct_lower = (content_type or "").lower()

    if "application/pdf" in ct_lower or fn_lower.endswith(".pdf"):
        b64_pdf = base64.b64encode(file_bytes).decode("utf-8")
        pdf_display = f"""
        <iframe
            src="data:application/pdf;base64,{b64_pdf}#toolbar=1&navpanes=0&scrollbar=1"
            width="100%"
            height="750px"
            type="application/pdf"
            style="border: 1px solid #CBD5E1; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-top: 10px;"
        >
            <p>Your browser does not support inline PDF viewing. Please use the Download button above.</p>
        </iframe>
        """
        st.markdown(pdf_display, unsafe_allow_html=True)
    elif ct_lower.startswith("image/") or fn_lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")):
        st.image(file_bytes, caption=filename, use_container_width=True)
    elif ct_lower.startswith("text/") or fn_lower.endswith((".txt", ".json", ".xml", ".csv", ".md", ".log", ".yaml", ".yml")):
        try:
            text_content = file_bytes.decode("utf-8")
            if fn_lower.endswith(".json") or "json" in ct_lower:
                st.json(json.loads(text_content))
            else:
                st.code(text_content)
        except Exception:
            st.text(file_bytes.decode("latin-1", errors="replace"))
    elif fn_lower.endswith((".docx", ".xlsx", ".pptx", ".doc", ".xls")):
        st.info(f"📦 Microsoft Office Document (`{filename}`). Download using the button above to view locally.")
    else:
        st.info(f"📦 Binary file payload (`{filename}`). Download using the button above to view.")



# ==============================================================================
# SIDEBAR NAVIGATION & CONFIGURATION
# ==============================================================================

st.sidebar.image("https://img.icons8.com/color/96/000000/amazon-web-services.png", width=60)
st.sidebar.title("AWS API Settings")

st.session_state.api_url = DEFAULT_API_URL if (
    "api_url" not in st.session_state 
    or "doc-platform-api" in st.session_state.get("api_url", "")
    or not st.session_state.get("api_url")
) else st.session_state.api_url

api_input = st.sidebar.text_input(
    "API Gateway Base URL",
    value=st.session_state.api_url,
    help="Enter live AWS API Gateway stage endpoint URL",
    key="api_gateway_url_input",
)
if "doc-platform-api" in api_input:
    api_input = DEFAULT_API_URL
st.session_state.api_url = api_input

if st.sidebar.button("🔄 Reset to Live AWS Endpoint"):
    st.session_state.api_url = DEFAULT_API_URL
    st.rerun()

col_cfg1, col_cfg2 = st.sidebar.columns(2)
with col_cfg1:
    st.session_state.verify_ssl = st.checkbox(
        "Verify SSL",
        value=st.session_state.verify_ssl,
        help="Enable standard TLS CA certificate verification",
    )
with col_cfg2:
    st.session_state.use_system_proxy = st.checkbox(
        "Use Proxy",
        value=st.session_state.use_system_proxy,
        help="Enable system HTTP/HTTPS proxy from environment",
    )

with st.sidebar.expander("Advanced Network / Proxy Settings", expanded=False):
    st.session_state.custom_proxy = st.text_input(
        "Custom Proxy URL",
        value=st.session_state.custom_proxy,
        placeholder="e.g. http://127.0.0.1:8080",
        help="Explicitly route requests through a custom proxy address or leave empty",
    )

# Instantiate a clean, fresh client on every run
client = APIClient(
    base_url=st.session_state.api_url,
    auth_token=st.session_state.auth_token,
    verify_ssl=st.session_state.verify_ssl,
    use_system_proxy=st.session_state.use_system_proxy,
    custom_proxy=st.session_state.custom_proxy,
)
client.request_logs = st.session_state.request_logs

# ------------------------------------------------------------------------------
# Sidebar Authentication Widget
# ------------------------------------------------------------------------------
st.sidebar.markdown("---")
st.sidebar.subheader("🔐 Auth & Identity")

# Display active authentication state badge
active_claims = parse_jwt_payload(st.session_state.auth_token)
if active_claims:
    user_name = active_claims.get("cognito:username") or active_claims.get("username") or active_claims.get("email") or active_claims.get("sub", "User")
    roles = active_claims.get("cognito:groups") or active_claims.get("roles", [])
    roles_str = ", ".join(roles) if isinstance(roles, list) and roles else "Document.Reader"
    st.sidebar.success(f"🟢 **{user_name}**\n\n🛡️ `{roles_str}`")
elif st.session_state.auth_token.startswith("x-mock-role:"):
    mock_role = st.session_state.auth_token.split("x-mock-role:")[-1]
    st.sidebar.info(f"🧪 **Mock Mode**\n\n🛡️ `{mock_role}`")
elif st.session_state.auth_token:
    st.sidebar.info("🔑 **Custom Token Set**")
else:
    st.sidebar.warning("⚪ **Unauthenticated** (Public endpoints only)")

with st.sidebar.expander("🔑 Quick Cognito Sign-In", expanded=not bool(st.session_state.auth_token)):
    st.session_state.cognito_client_id = st.text_input(
        "Cognito Client ID",
        value=st.session_state.cognito_client_id,
        placeholder="e.g. 2abcdef123456789...",
        help="App Client ID from Cognito User Pool in SecurityStack",
    )
    user_options = ["admin-user", "writer-user", "editor-user", "reader-user", "Custom Username"]
    curr_idx = user_options.index(st.session_state.cognito_username) if st.session_state.cognito_username in user_options else 4
    selected_user = st.selectbox("Preset User", user_options, index=curr_idx)
    if selected_user == "Custom Username":
        st.session_state.cognito_username = st.text_input("Username", value=st.session_state.cognito_username)
    else:
        st.session_state.cognito_username = selected_user

    st.session_state.cognito_password = st.text_input(
        "Password",
        value=st.session_state.cognito_password,
        type="password",
        placeholder="Cognito password",
    )
    
    if st.button("🚀 Sign In", type="primary", use_container_width=True):
        if not st.session_state.cognito_client_id:
            st.sidebar.error("Enter Cognito Client ID.")
        elif not st.session_state.cognito_username:
            st.sidebar.error("Enter Username.")
        elif not st.session_state.cognito_password:
            st.sidebar.error("Enter Password.")
        else:
            with st.spinner("Authenticating..."):
                status_code, payload, duration_ms, curl_cmd = client.authenticate_cognito(
                    client_id=st.session_state.cognito_client_id.strip(),
                    username=st.session_state.cognito_username.strip(),
                    password=st.session_state.cognito_password,
                    region=st.session_state.cognito_region.strip(),
                )
            if status_code == 200 and isinstance(payload, dict) and "AuthenticationResult" in payload:
                auth_res = payload["AuthenticationResult"]
                id_token = auth_res.get("IdToken") or auth_res.get("AccessToken")
                st.session_state.auth_token = id_token
                st.sidebar.success("Authenticated!")
                st.rerun()
            else:
                err_msg = payload.get("message") if isinstance(payload, dict) else str(payload)
                err_type = payload.get("__type", "Error") if isinstance(payload, dict) else "Error"
                st.sidebar.error(f"{err_type}: {err_msg}")

with st.sidebar.expander("🧪 Test / Mock Auth Tokens", expanded=False):
    st.caption("Inject mock role headers for local test bypass:")
    col_m1, col_m2 = st.columns(2)
    with col_m1:
        if st.button("👑 Admin", use_container_width=True):
            st.session_state.auth_token = "x-mock-role:Document.Admin"
            st.rerun()
        if st.button("✏️ Editor", use_container_width=True):
            st.session_state.auth_token = "x-mock-role:Document.MetadataEditor"
            st.rerun()
    with col_m2:
        if st.button("✍️ Writer", use_container_width=True):
            st.session_state.auth_token = "x-mock-role:Document.Writer"
            st.rerun()
        if st.button("👁️ Reader", use_container_width=True):
            st.session_state.auth_token = "x-mock-role:Document.Reader"
            st.rerun()

st.session_state.auth_token = st.sidebar.text_input(
    "Active Bearer Token",
    value=st.session_state.auth_token,
    type="password",
    help="Raw JWT or Authorization header value passed in API requests",
)

if st.session_state.auth_token:
    if st.sidebar.button("🚪 Sign Out / Clear Token", use_container_width=True):
        st.session_state.auth_token = ""
        st.rerun()

st.sidebar.markdown("---")
st.sidebar.subheader("Active Session State")
st.sidebar.text_input("Active Document ID", value=st.session_state.last_doc_id, key="sidebar_doc_id_display", disabled=True)
st.sidebar.text_input("Active Upload Session ID", value=st.session_state.last_upload_id, key="sidebar_upload_id_display", disabled=True)
st.sidebar.metric("Last Known Revision", value=st.session_state.last_metadata_revision)

st.sidebar.markdown("---")
if st.sidebar.button("Pre-fill Demo Sample Values"):
    st.session_state.last_doc_id = "740c486b-80fa-4d68-99cd-68fbfaada3c9"
    st.rerun()

# ==============================================================================
# HEADER & TABS
# ==============================================================================

st.markdown('<div class="main-title">AWS Document Management Platform</div>', unsafe_allow_html=True)
st.markdown(
    '<div class="sub-title">Interactive Web GUI for AWS API Gateway REST Operations (Upload, Versioning, S3 Metadata Annotations, Optimistic Concurrency & OpenSearch Search)</div>',
    unsafe_allow_html=True,
)

tab_auth, tab_health, tab_upload, tab_doc, tab_metadata, tab_search, tab_admin, tab_inspector = st.tabs(
    [
        "🔐 Authentication & Roles",
        "🟢 System Health",
        "📤 Document Upload",
        "📄 Document Viewer & Versions",
        "✏️ Metadata & Optimistic Concurrency",
        "🔍 OpenSearch Query",
        "🛡️ Lifecycle Management",
        "⚡ Live Request Inspector",
    ]
)


# ==============================================================================
# TAB 0: AUTHENTICATION & ROLES
# ==============================================================================
with tab_auth:
    st.header("AWS Cognito Authentication & RBAC")
    st.write("Authenticate with AWS Cognito User Pools to obtain JWT Bearer tokens with Role-Based Access Control (RBAC).")

    col_auth_left, col_auth_right = st.columns([1, 1])

    with col_auth_left:
        st.subheader("🔑 Sign In with AWS Cognito")
        with st.form("cognito_login_form"):
            form_client_id = st.text_input(
                "Cognito App Client ID",
                value=st.session_state.cognito_client_id,
                placeholder="e.g. 2abcdef123456789...",
                help="App Client ID from Cognito User Pool in SecurityStack",
            )
            form_region = st.text_input(
                "AWS Region",
                value=st.session_state.cognito_region,
                help="AWS Region (e.g. us-east-1)",
            )
            preset_user = st.selectbox(
                "Select User Account",
                ["admin-user", "writer-user", "editor-user", "reader-user", "Custom Username"],
                index=0,
            )
            custom_username = ""
            if preset_user == "Custom Username":
                custom_username = st.text_input("Custom Username", value="")
            
            form_password = st.text_input("Password", type="password", placeholder="Enter user password")
            submit_auth = st.form_submit_button("🚀 Authenticate & Acquire Token", type="primary", use_container_width=True)

            if submit_auth:
                selected_username = custom_username if preset_user == "Custom Username" else preset_user
                if not form_client_id:
                    st.error("Please provide a Cognito Client ID.")
                elif not selected_username:
                    st.error("Please specify a username.")
                elif not form_password:
                    st.error("Please enter the user password.")
                else:
                    st.session_state.cognito_client_id = form_client_id
                    st.session_state.cognito_region = form_region
                    st.session_state.cognito_username = selected_username
                    with st.spinner("Authenticating with Cognito User Pool..."):
                        status_code, payload, duration_ms, curl_cmd = client.authenticate_cognito(
                            client_id=form_client_id.strip(),
                            username=selected_username.strip(),
                            password=form_password,
                            region=form_region.strip(),
                        )
                    if status_code == 200 and isinstance(payload, dict) and "AuthenticationResult" in payload:
                        auth_res = payload["AuthenticationResult"]
                        id_token = auth_res.get("IdToken") or auth_res.get("AccessToken")
                        st.session_state.auth_token = id_token
                        st.success(f"Successfully authenticated as **{selected_username}** ({duration_ms} ms)")
                        st.rerun()
                    else:
                        err_msg = payload.get("message") if isinstance(payload, dict) else str(payload)
                        err_type = payload.get("__type", "AuthenticationError") if isinstance(payload, dict) else "Error"
                        st.error(f"Authentication Failed [{err_type}]: {err_msg}")
                        display_curl_and_json(curl_cmd, payload)

        st.markdown("---")
        st.subheader("🧪 Quick Mock Roles (Local / Bypass Mode)")
        st.caption("Instantly inject role headers for local test environments without Cognito credentials:")
        col_qb1, col_qb2 = st.columns(2)
        with col_qb1:
            if st.button("👑 Use Mock Admin", key="btn_mock_admin", use_container_width=True):
                st.session_state.auth_token = "x-mock-role:Document.Admin"
                st.rerun()
            if st.button("✏️ Use Mock Editor", key="btn_mock_editor", use_container_width=True):
                st.session_state.auth_token = "x-mock-role:Document.MetadataEditor"
                st.rerun()
        with col_qb2:
            if st.button("✍️ Use Mock Writer", key="btn_mock_writer", use_container_width=True):
                st.session_state.auth_token = "x-mock-role:Document.Writer"
                st.rerun()
            if st.button("👁️ Use Mock Reader", key="btn_mock_reader", use_container_width=True):
                st.session_state.auth_token = "x-mock-role:Document.Reader"
                st.rerun()

    with col_auth_right:
        st.subheader("🛡️ Active Identity & Token Claims")
        if st.session_state.auth_token:
            decoded_claims = parse_jwt_payload(st.session_state.auth_token)
            if decoded_claims:
                st.success("🟢 **Valid Cognito JWT Token Active**")
                
                user_id = decoded_claims.get("cognito:username") or decoded_claims.get("username") or decoded_claims.get("sub", "N/A")
                email = decoded_claims.get("email", "N/A")
                groups = decoded_claims.get("cognito:groups") or decoded_claims.get("roles", ["Document.Reader"])
                exp_ts = decoded_claims.get("exp")
                exp_str = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(exp_ts)) if exp_ts else "N/A"

                col_c1, col_c2 = st.columns(2)
                col_c1.metric("User ID / Username", str(user_id))
                col_c2.metric("Email", str(email))
                col_c1.metric("Assigned Role(s)", ", ".join(groups) if isinstance(groups, list) else str(groups))
                col_c2.metric("Token Expiry", exp_str)

                with st.expander("🔍 View Raw Decoded JWT Claims", expanded=False):
                    st.json(decoded_claims)
            elif st.session_state.auth_token.startswith("x-mock-role:"):
                mock_role_name = st.session_state.auth_token.split("x-mock-role:")[-1]
                st.info(f"🧪 **Mock Role Active:** `{mock_role_name}`")
                st.write("Requests will carry mock headers `x-mock-role` and `x-mock-user`.")
            else:
                st.info("🔑 **Custom Authorization Token Active**")

            if st.button("🚪 Sign Out / Clear Token", key="btn_signout_tab", type="secondary", use_container_width=True):
                st.session_state.auth_token = ""
                st.rerun()
        else:
            st.warning("⚪ **No Active Authentication Token**\n\nRequests to protected API routes will return `401 Unauthorized` or `403 Forbidden`.")

        st.markdown("---")
        st.subheader("📋 RBAC Permissions Reference")
        rbac_data = [
            {"Role": "Document.Reader", "Retrieve / Download": "✅", "OpenSearch Query": "✅", "Upload / Version": "❌", "Edit Metadata": "❌", "Soft-Delete / Restore": "❌"},
            {"Role": "Document.Writer", "Retrieve / Download": "✅", "OpenSearch Query": "✅", "Upload / Version": "✅", "Edit Metadata": "❌", "Soft-Delete / Restore": "❌"},
            {"Role": "Document.MetadataEditor", "Retrieve / Download": "✅", "OpenSearch Query": "✅", "Upload / Version": "❌", "Edit Metadata": "✅", "Soft-Delete / Restore": "❌"},
            {"Role": "Document.Admin", "Retrieve / Download": "✅", "OpenSearch Query": "✅", "Upload / Version": "✅", "Edit Metadata": "✅", "Soft-Delete / Restore": "✅"},
        ]
        st.dataframe(pd.DataFrame(rbac_data), use_container_width=True, hide_index=True)


# ==============================================================================
# TAB 1: SYSTEM HEALTH
# ==============================================================================
with tab_health:
    st.header("Operational Health Check (`GET /health`)")
    st.write("Verifies operational status of the AWS API Gateway & backend Lambda infrastructure.")

    if st.button("Ping Health Endpoint", type="primary"):
        with st.spinner("Pinging API Gateway..."):
            status_code, payload, duration_ms, curl_cmd = client.get_health()

        col1, col2, col3 = st.columns(3)
        col1.metric("Status Code", status_code if status_code != 0 else "Offline")
        col2.metric("Latency", f"{duration_ms} ms")
        col3.metric("Service Status", payload.get("status", "N/A") if isinstance(payload, dict) else "N/A")

        render_response_status(status_code, duration_ms)
        display_curl_and_json(curl_cmd, payload)

# ==============================================================================
# TAB 2: DOCUMENT UPLOAD
# ==============================================================================
with tab_upload:
    st.header("Document Ingestion")

    upload_mode = st.radio("Upload Mechanism", ["Inline Upload (<= 4 MiB)", "Direct Presigned S3 Upload (> 4 MiB)"], horizontal=True)

    if upload_mode == "Inline Upload (<= 4 MiB)":
        st.subheader("Inline Upload (`POST /documents`)")
        st.write("Uploads document payload up to 4 MiB through API Gateway Lambda with authoritative metadata envelope.")

        col_f1, col_f2 = st.columns([1, 1])

        with col_f1:
            uploaded_file = st.file_uploader("Select File to Upload", type=["pdf", "jpeg", "png", "tiff", "txt"])
            content_type = st.selectbox("Content-Type", ["application/pdf", "image/jpeg", "image/tiff", "application/octet-stream"])
            idempotency_key = st.text_input("Idempotency-Key (UUID)", value=str(uuid.uuid4()))

        with col_f2:
            st.markdown("##### Document Metadata Envelope")
            cust_id = st.text_input("Customer ID", value="IL-4492817")
            loan_num = st.text_input("Loan Number", value="LN-2026-88821")
            loan_amt = st.number_input("Loan Amount (Minor Units)", value=90000000, step=100000)
            currency = st.selectbox("Currency", ["ILS", "USD", "EUR", "GBP"])
            loan_type = st.selectbox("Loan Type", ["MORTGAGE", "PERSONAL", "COMMERCIAL", "AUTO"])
            branch_code = st.text_input("Branch Code", value="TLV-04")
            signed_date = st.date_input("Signed Date").strftime("%Y-%m-%d")
            doc_type = st.selectbox("Document Type", ["SIGNED_AGREEMENT", "APPLICATION", "DISCLOSURE", "PROMISSORY_NOTE"])

        if st.button("Execute Inline Upload", type="primary"):
            if uploaded_file is None:
                file_bytes = b"PDF-CONTENT-DEMO-SAMPLE-BYTES-AWS-PLATFORM"
                filename = "loan_agreement_sample.pdf"
            else:
                file_bytes = uploaded_file.getvalue()
                filename = uploaded_file.name

            metadata = {
                "document_class": "loan_agreement",
                "document_type": doc_type,
                "customer_id": cust_id,
                "loan_number": loan_num,
                "loan_amount_minor_units": loan_amt,
                "currency": currency,
                "loan_type": loan_type,
                "branch_code": branch_code,
                "signed_date": signed_date,
                "filename": filename,
            }

            with st.spinner("Sending inline upload request..."):
                status_code, payload, duration_ms, curl_cmd = client.upload_inline_document(
                    file_bytes=file_bytes,
                    metadata=metadata,
                    content_type=content_type,
                    idempotency_key=idempotency_key,
                )

            render_response_status(status_code, duration_ms)
            display_curl_and_json(curl_cmd, payload)

            if isinstance(payload, dict) and "document_id" in payload:
                st.session_state.last_doc_id = payload["document_id"]
                st.session_state.last_metadata_revision = payload.get("metadata_revision", 1)
                st.success(f"Document Created Successfully! Document ID: `{payload['document_id']}`")

    else:
        st.subheader("Direct Presigned Upload Workflow (`POST /documents/uploads`)")
        st.write("Initiates a direct S3 single-PUT presigned upload for files larger than 4 MiB.")

        step = st.radio("Step", ["1. Initiate Upload Session", "2. Upload Binary to S3 Presigned URL", "3. Complete / Cancel Upload Session"], horizontal=True)

        if step == "1. Initiate Upload Session":
            st.markdown("#### Step 1: Initiate Upload Session")
            direct_file = st.file_uploader("Select Large File (>4MB)", type=["pdf", "tiff", "zip", "bin"], key="direct_file")
            filename = st.text_input("Filename", value="large_loan_agreement.pdf")
            content_len = st.number_input("Content Length (bytes)", value=5242880)
            checksum = st.text_input("SHA-256 Checksum", value="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")

            cust_id_d = st.text_input("Customer ID", value="IL-9988776", key="d_cust")
            loan_num_d = st.text_input("Loan Number", value="LN-2026-99999", key="d_loan")
            loan_amt_d = st.number_input("Loan Amount (Minor Units)", value=50000000, key="d_amt")

            if st.button("Initiate Direct Upload Session", type="primary"):
                metadata_d = {
                    "document_type": "SIGNED_AGREEMENT",
                    "customer_id": cust_id_d,
                    "loan_number": loan_num_d,
                    "loan_amount_minor_units": loan_amt_d,
                    "currency": "ILS",
                    "loan_type": "MORTGAGE",
                    "branch_code": "TLV-01",
                    "signed_date": "2026-07-20",
                }

                with st.spinner("Initiating session..."):
                    status_code, payload, duration_ms, curl_cmd = client.initiate_direct_upload(
                        filename=filename,
                        content_length=content_len,
                        checksum=checksum,
                        metadata=metadata_d,
                    )

                render_response_status(status_code, duration_ms)
                display_curl_and_json(curl_cmd, payload)

                if isinstance(payload, dict) and "upload_id" in payload:
                    st.session_state.last_upload_id = payload["upload_id"]
                    st.session_state.last_doc_id = payload.get("document_id", "")
                    st.session_state.last_presigned_url = payload.get("upload_url", "")
                    st.success(f"Upload Session Initiated! Upload ID: `{payload['upload_id']}`")

        elif step == "2. Upload Binary to S3 Presigned URL":
            st.markdown("#### Step 2: PUT Binary to Presigned URL")
            upload_url = st.text_input("S3 Presigned Upload URL", value=st.session_state.last_presigned_url)
            binary_data = st.text_area("Dummy Binary Content / Bytes", value="DEMO-LARGE-FILE-CONTENT-S3-DIRECT-PUT")

            if st.button("PUT to S3 Presigned URL", type="primary"):
                with st.spinner("Uploading binary payload directly to S3..."):
                    status_code, payload, duration_ms, curl_cmd = client.upload_to_presigned_url(
                        upload_url=upload_url,
                        file_bytes=binary_data.encode("utf-8"),
                    )

                render_response_status(status_code, duration_ms)
                display_curl_and_json(curl_cmd, payload)

        elif step == "3. Complete / Cancel Upload Session":
            st.markdown("#### Step 3: Complete or Cancel Session")
            upload_id_input = st.text_input("Upload Session ID", value=st.session_state.last_upload_id)

            col_c1, col_c2 = st.columns(2)
            with col_c1:
                if st.button("Complete Upload Session (`POST /complete`)", type="primary"):
                    with st.spinner("Completing direct upload..."):
                        status_code, payload, duration_ms, curl_cmd = client.complete_direct_upload(upload_id_input)
                    render_response_status(status_code, duration_ms)
                    display_curl_and_json(curl_cmd, payload)

            with col_c2:
                if st.button("Cancel Upload Session (`DELETE`)"):
                    with st.spinner("Cancelling upload..."):
                        status_code, payload, duration_ms, curl_cmd = client.cancel_direct_upload(upload_id_input)
                    render_response_status(status_code, duration_ms)
                    display_curl_and_json(curl_cmd, payload)

# ==============================================================================
# TAB 3: DOCUMENT VIEWER & VERSIONS
# ==============================================================================
with tab_doc:
    st.header("Document Viewer & Application Versioning")

    doc_id_input = st.text_input("Target Document ID (UUID)", value=st.session_state.last_doc_id, key="doc_id_input_field")
    if doc_id_input and doc_id_input != st.session_state.last_doc_id:
        st.session_state.last_doc_id = doc_id_input

    col_btn1, col_btn2, col_btn3 = st.columns(3)
    with col_btn1:
        btn_details = st.button("📄 Document Details (`GET`)")
    with col_btn2:
        btn_dl_url = st.button("🔗 Download URL (`GET`)")
    with col_btn3:
        btn_preview = st.button("👁️ Fetch & View in UI", type="primary")

    if btn_details:
        if not doc_id_input:
            st.error("Please enter a valid Document ID.")
        else:
            with st.spinner("Fetching document details..."):
                status_code, payload, duration_ms, curl_cmd = client.get_document(doc_id_input)
            render_response_status(status_code, duration_ms)
            display_curl_and_json(curl_cmd, payload)

            if isinstance(payload, dict) and "current_metadata_revision" in payload:
                st.session_state.last_metadata_revision = payload["current_metadata_revision"]

    if btn_dl_url:
        if not doc_id_input:
            st.error("Please enter a valid Document ID.")
        else:
            with st.spinner("Generating download URL..."):
                status_code, payload, duration_ms, curl_cmd = client.get_download_url(doc_id_input)
            render_response_status(status_code, duration_ms)
            display_curl_and_json(curl_cmd, payload)

    if btn_preview:
        if not doc_id_input:
            st.error("Please enter a valid Document ID.")
        else:
            with st.spinner("Generating download URL and retrieving document from S3..."):
                status_code, dl_payload, duration_ms, curl_cmd = client.get_download_url(doc_id_input)
                if status_code != 200 or not isinstance(dl_payload, dict) or "download_url" not in dl_payload:
                    render_response_status(status_code, duration_ms)
                    display_curl_and_json(curl_cmd, dl_payload)
                else:
                    dl_url = dl_payload["download_url"]
                    m_status, m_payload, _, _ = client.get_metadata(doc_id_input)
                    filename = (
                        m_payload.get("filename")
                        if isinstance(m_payload, dict) and m_payload.get("filename")
                        else f"document_{doc_id_input[:8]}.pdf"
                    )
                    content_type = (
                        m_payload.get("content_type")
                        if isinstance(m_payload, dict) and m_payload.get("content_type")
                        else "application/pdf"
                    )
                    b_status, file_bytes, s3_ct, _ = client.fetch_file_bytes(dl_url)
                    if b_status == 200 and file_bytes is not None:
                        st.session_state.preview_doc = {
                            "document_id": doc_id_input,
                            "filename": filename,
                            "content_type": content_type or s3_ct,
                            "bytes": file_bytes,
                            "version_num": None,
                        }
                    else:
                        st.error(f"Failed to fetch content from S3 (HTTP {b_status}).")

    # Render Preview if present in session state for current doc
    if st.session_state.preview_doc and st.session_state.preview_doc.get("document_id") == doc_id_input:
        pd = st.session_state.preview_doc
        render_embedded_document_viewer(
            file_bytes=pd["bytes"],
            filename=pd["filename"],
            content_type=pd["content_type"],
            document_id=pd["document_id"],
            version_num=pd.get("version_num"),
        )

    st.markdown("---")
    st.subheader("Document Content Version History")

    col_v1, col_v2 = st.columns(2)
    with col_v1:
        if st.button("List All Content Versions (`GET /versions`)"):
            with st.spinner("Listing versions..."):
                status_code, payload, duration_ms, curl_cmd = client.list_versions(doc_id_input)
            render_response_status(status_code, duration_ms)
            display_curl_and_json(curl_cmd, payload)

            if isinstance(payload, dict) and "versions" in payload:
                st.dataframe(pd.DataFrame(payload["versions"]))

    with col_v2:
        ver_num = st.number_input("Version Number", min_value=1, value=1)
        col_vh1, col_vh2 = st.columns(2)
        with col_vh1:
            btn_ver_details = st.button("Get Version Details")
        with col_vh2:
            btn_ver_preview = st.button("👁️ View This Version")

        if btn_ver_details:
            with st.spinner("Retrieving version..."):
                status_code, payload, duration_ms, curl_cmd = client.get_version(doc_id_input, int(ver_num))
            render_response_status(status_code, duration_ms)
            display_curl_and_json(curl_cmd, payload)

        if btn_ver_preview:
            with st.spinner(f"Fetching Version {ver_num} from S3..."):
                status_code, dl_payload, duration_ms, curl_cmd = client.get_download_url(doc_id_input, version=int(ver_num))
                if status_code == 200 and isinstance(dl_payload, dict) and "download_url" in dl_payload:
                    dl_url = dl_payload["download_url"]
                    m_status, m_payload, _, _ = client.get_metadata(doc_id_input)
                    filename = (
                        m_payload.get("filename")
                        if isinstance(m_payload, dict) and m_payload.get("filename")
                        else f"document_{doc_id_input[:8]}_v{ver_num}.pdf"
                    )
                    content_type = (
                        m_payload.get("content_type")
                        if isinstance(m_payload, dict) and m_payload.get("content_type")
                        else "application/pdf"
                    )
                    b_status, file_bytes, s3_ct, _ = client.fetch_file_bytes(dl_url)
                    if b_status == 200 and file_bytes is not None:
                        st.session_state.preview_doc = {
                            "document_id": doc_id_input,
                            "filename": filename,
                            "content_type": content_type or s3_ct,
                            "bytes": file_bytes,
                            "version_num": int(ver_num),
                        }
                        st.rerun()
                    else:
                        st.error(f"Failed to fetch version content from S3 (HTTP {b_status}).")
                else:
                    render_response_status(status_code, duration_ms)
                    display_curl_and_json(curl_cmd, dl_payload)

    st.markdown("##### Upload New Content Version (`POST /documents/{id}/versions`)")
    new_ver_file = st.file_uploader("Select New Content Payload File", type=["pdf", "png", "txt"], key="new_ver_file")

    if st.button("Create New Content Version", type="primary"):
        if new_ver_file is None:
            bytes_data = b"PDF-CONTENT-VERSION-NEW-BYTES"
        else:
            bytes_data = new_ver_file.getvalue()

        with st.spinner("Uploading new content version..."):
            status_code, payload, duration_ms, curl_cmd = client.create_version(doc_id_input, bytes_data)
        render_response_status(status_code, duration_ms)
        display_curl_and_json(curl_cmd, payload)

# ==============================================================================
# TAB 4: METADATA & OPTIMISTIC CONCURRENCY
# ==============================================================================
with tab_metadata:
    st.header("Optimistic Concurrency Metadata Editor")
    st.write("Demonstrates authoritative S3 metadata updates with optimistic concurrency control (`expected_metadata_revision`).")

    doc_id_meta = st.text_input("Document ID for Metadata Update", value=st.session_state.last_doc_id, key="doc_id_meta")

    if st.button("Fetch Current Authoritative Metadata (`GET /metadata`)"):
        with st.spinner("Fetching S3 metadata annotation..."):
            status_code, payload, duration_ms, curl_cmd = client.get_metadata(doc_id_meta)
        render_response_status(status_code, duration_ms)
        display_curl_and_json(curl_cmd, payload)
        if isinstance(payload, dict) and "metadata_revision" in payload:
            st.session_state.last_metadata_revision = payload["metadata_revision"]

    st.markdown("---")
    st.subheader("Update Metadata Form")

    col_m1, col_m2 = st.columns(2)
    with col_m1:
        new_branch = st.text_input("New Branch Code", value="TLV-05")
        new_amount = st.number_input("New Loan Amount (Minor Units)", value=95000000)
        update_reason = st.text_input("Update Reason", value="CORRECTION")

    with col_m2:
        exp_revision = st.number_input(
            "expected_metadata_revision",
            min_value=1,
            value=int(st.session_state.last_metadata_revision),
            help="Expected revision number to match against S3 metadata version pointer",
        )

    col_act1, col_act2 = st.columns(2)

    with col_act1:
        if st.button("Submit Valid Metadata Update", type="primary"):
            changes = {"branch_code": new_branch, "loan_amount_minor_units": new_amount}
            with st.spinner("Submitting metadata update..."):
                status_code, payload, duration_ms, curl_cmd = client.update_metadata(
                    document_id=doc_id_meta,
                    expected_metadata_revision=exp_revision,
                    changes=changes,
                    reason=update_reason,
                )
            render_response_status(status_code, duration_ms)
            display_curl_and_json(curl_cmd, payload)

            if isinstance(payload, dict) and "metadata_revision" in payload:
                st.session_state.last_metadata_revision = payload["metadata_revision"]
                st.success(f"Metadata updated! New Revision: `{payload['metadata_revision']}`")

    with col_act2:
        if st.button("💥 Simulate Stale Update Conflict (Expect 409 Error)"):
            stale_revision = max(1, exp_revision - 1)
            changes = {"branch_code": "TLV-STALE-CONFLICT"}
            st.warning(f"Sending request with stale revision = {stale_revision} (Current revision = {exp_revision})...")

            with st.spinner("Sending stale update..."):
                status_code, payload, duration_ms, curl_cmd = client.update_metadata(
                    document_id=doc_id_meta,
                    expected_metadata_revision=stale_revision,
                    changes=changes,
                    reason="STALE_CONFLICT_DEMO",
                )
            render_response_status(status_code, duration_ms)
            display_curl_and_json(curl_cmd, payload)

# ==============================================================================
# TAB 5: OPENSEARCH QUERY & SEARCH
# ==============================================================================
with tab_search:
    st.header("OpenSearch Structured Document Search (`POST /search`)")
    st.write("Executes structured metadata queries against OpenSearch Serverless index.")

    col_s1, col_s2, col_s3 = st.columns(3)
    with col_s1:
        s_doc_class = st.text_input("Document Class Filter", value="loan_agreement", help="Leave blank or specify class")
        s_filename = st.text_input("Filename Filter", value="", placeholder="e.g. loan_LN-2026-88821.pdf (Optional)")
    with col_s2:
        s_cust_id = st.text_input("Customer ID Filter", value="", placeholder="e.g. IL-4492817 (Optional)")
        s_doc_type = st.selectbox("Document Type Filter", ["", "SIGNED_AGREEMENT", "APPLICATION", "DISCLOSURE", "PROMISSORY_NOTE"])
    with col_s3:
        s_branch = st.text_input("Branch Code Filter", value="", placeholder="e.g. TLV-04 (Optional)")
        s_loan_type = st.selectbox("Loan Type Filter", ["", "MORTGAGE", "PERSONAL", "COMMERCIAL", "AUTO"])

    col_sort1, col_sort2 = st.columns(2)
    with col_sort1:
        sort_field = st.selectbox("Sort Field", ["created_at", "updated_at"])
    with col_sort2:
        s_page_size = st.slider("Page Size", min_value=1, max_value=100, value=20)
    sort_dir = st.radio("Sort Direction", ["desc", "asc"], horizontal=True)

    if st.button("Execute OpenSearch Search", type="primary"):
        filters = {}
        if s_doc_class:
            filters["document_class"] = s_doc_class
        if s_filename:
            filters["filename"] = s_filename
        if s_cust_id:
            filters["customer_id"] = s_cust_id
        if s_doc_type:
            filters["document_type"] = s_doc_type
        if s_loan_type:
            filters["loan_type"] = s_loan_type
        if s_branch:
            filters["branch_code"] = s_branch

        sort_opt = {"field": sort_field, "direction": sort_dir}

        with st.spinner("Querying OpenSearch..."):
            status_code, payload, duration_ms, curl_cmd = client.search_documents(
                filters=filters,
                sort=sort_opt,
                page_size=s_page_size,
            )

        render_response_status(status_code, duration_ms)
        display_curl_and_json(curl_cmd, payload)

        if isinstance(payload, dict) and "items" in payload:
            items = payload["items"]
            st.subheader(f"Search Results (Total: {payload.get('total', len(items))})")
            if items:
                df = pd.DataFrame(items)
                # Prioritize key columns at the front
                priority_cols = ["filename", "document_id", "document_class", "document_type", "customer_id", "loan_number", "loan_amount_minor_units", "currency", "branch_code", "created_at"]
                ordered_cols = [c for c in priority_cols if c in df.columns] + [c for c in df.columns if c not in priority_cols]
                st.dataframe(df[ordered_cols], use_container_width=True)

                st.markdown("---")
                st.markdown("##### 👁️ Quick Action: Load Document into Viewer")
                doc_options = [f"{it.get('filename', 'Unnamed')} | ID: {it.get('document_id')}" for it in items if "document_id" in it]
                selected_opt = st.selectbox("Select document to inspect:", doc_options, key="search_select_doc")
                if st.button("📥 Load into Document Viewer Tab", key="btn_load_search_doc"):
                    sel_id = selected_opt.split("ID: ")[-1].strip()
                    st.session_state.last_doc_id = sel_id
                    st.session_state.preview_doc = None
                    st.success(f"Loaded document `{sel_id}` into session! Switch to the **'📂 Document Viewer'** tab and click **'Fetch & View in UI'**.")
            else:
                st.info("No matching documents found.")

# ==============================================================================
# TAB 6: LIFECYCLE MANAGEMENT
# ==============================================================================
with tab_admin:
    st.header("Document Lifecycle Management")
    st.write("Administrative soft-delete and restore operations (requires `Document.Admin` permission).")

    admin_doc_id = st.text_input("Target Document ID for Lifecycle Action", value=st.session_state.last_doc_id, key="admin_doc_id")

    col_adm1, col_adm2 = st.columns(2)

    with col_adm1:
        st.subheader("Soft Delete Document (`POST /soft-delete`)")
        st.caption("Marks document as SOFT_DELETED and removes it from OpenSearch Serverless index.")
        if st.button("Soft Delete Document", type="primary"):
            with st.spinner("Soft deleting..."):
                status_code, payload, duration_ms, curl_cmd = client.soft_delete_document(admin_doc_id)
            render_response_status(status_code, duration_ms)
            display_curl_and_json(curl_cmd, payload)

    with col_adm2:
        st.subheader("Restore Document (`POST /restore`)")
        st.caption("Restores soft-deleted document back to ACTIVE status and re-indexes in OpenSearch.")
        if st.button("Restore Document"):
            with st.spinner("Restoring document..."):
                status_code, payload, duration_ms, curl_cmd = client.restore_document(admin_doc_id)
            render_response_status(status_code, duration_ms)
            display_curl_and_json(curl_cmd, payload)

# ==============================================================================
# TAB 7: LIVE REQUEST INSPECTOR
# ==============================================================================
with tab_inspector:
    st.header("Live HTTP Request Inspector & Audit Log")
    st.write("Displays live audit history of all API calls executed through the Web GUI.")

    if st.button("Clear Audit Log"):
        client.request_logs.clear()
        st.rerun()

    if client.request_logs:
        log_df = pd.DataFrame(
            [
                {
                    "Timestamp": l["timestamp"],
                    "Method": l["method"],
                    "URL": l["url"],
                    "Status": l["status_code"],
                    "Latency (ms)": l["duration_ms"],
                }
                for l in client.request_logs
            ]
        )
        st.dataframe(log_df, use_container_width=True)

        selected_idx = st.selectbox("Inspect Specific Request", range(len(client.request_logs)), format_func=lambda i: f"[{client.request_logs[i]['timestamp']}] {client.request_logs[i]['method']} {client.request_logs[i]['url']} ({client.request_logs[i]['status_code']})")

        selected_log = client.request_logs[selected_idx]
        st.markdown("#### Request Details")
        st.code(selected_log["curl"], language="bash")
        col_in1, col_in2 = st.columns(2)
        with col_in1:
            st.markdown("**Request Payload:**")
            st.json(selected_log["request_payload"])
        with col_in2:
            st.markdown("**Response Body:**")
            st.json(selected_log["response"])
    else:
        st.info("No requests executed yet in this session.")
