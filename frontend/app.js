// AWS Document Management Platform — Serverless SPA Client Logic

// Global Application State
const state = {
  config: {
    apiUrl: 'https://k0urmbeen9.execute-api.us-east-1.amazonaws.com/v1',
    userPoolId: 'us-east-1_aMUcSBi6e',
    userPoolClientId: '3fcn104kkvrb642f33khd5c0p6',
    region: 'us-east-1',
  },
  auth: {
    token: localStorage.getItem('doc_platform_token') || '',
    user: null,
    claims: null,
  },
  activeDocument: null,
  currency: 'USD',
  auditLogs: [],
};

// ==========================================
// 1. INITIALIZATION & CONFIG
// ==========================================
async function initApp() {
  setupTabs();
  
  // Try loading runtime config.json injected by CDK / S3
  try {
    const res = await fetch('./config.json');
    if (res.ok) {
      const cfg = await res.json();
      state.config = { ...state.config, ...cfg };
    }
  } catch (err) {
    console.warn('Using default config fallback:', err);
  }

  const regionSpan = document.getElementById('health-card-region');
  if (regionSpan) regionSpan.innerText = state.config.region;

  // Check and restore active auth session
  if (state.auth.token) {
    parseAndSetToken(state.auth.token);
  } else {
    showLoginView();
  }

  // Run cost calculator & health
  updateCalculator();
}

function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetContent = document.getElementById(targetId);
      if (targetContent) targetContent.classList.add('active');

      if (targetId === 'tab-search') {
        executeSearch();
      }
    });
  });
}

function showLoginView() {
  document.body.classList.remove('authenticated');
  document.body.classList.add('unauthenticated');
}

function showAppView() {
  document.body.classList.remove('unauthenticated');
  document.body.classList.add('authenticated');
  checkHealth();
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast alert-${type}`;
  const icon = type === 'success' ? '✅' : type === 'danger' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================
// 2. COGNITO AUTHENTICATION & JWT
// ==========================================
async function authenticateCognito(username, password) {
  const endpoint = `https://cognito-idp.${state.config.region}.amazonaws.com/`;
  const payload = {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: state.config.userPoolClientId,
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password,
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.__type || 'Authentication failed');
  }

  const token = data.AuthenticationResult?.IdToken || data.AuthenticationResult?.AccessToken;
  if (!token) throw new Error('No authentication token received');
  return token;
}

async function loginUser(username, password) {
  const submitBtn = document.getElementById('btn-login-submit');
  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = '⏳ Authenticating...';
    }
    showToast(`Authenticating ${username}...`, 'info');
    const token = await authenticateCognito(username, password);
    parseAndSetToken(token);
    showToast(`Welcome, ${username}! Access granted.`, 'success');
  } catch (err) {
    showToast(`Authentication failed: ${err.message}`, 'danger');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = '🚀 Sign In & Enter Portal';
    }
  }
}

async function handleLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username || !password) {
    showToast('Please enter both username and password', 'warning');
    return;
  }

  await loginUser(username, password);
}

function parseAndSetToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payloadJson = decodeURIComponent(
        atob(payloadBase64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      const claims = JSON.parse(payloadJson);

      // Check expiration
      if (claims.exp && claims.exp * 1000 < Date.now()) {
        console.warn('Stored JWT token has expired');
        signOut();
        return;
      }

      state.auth.token = token;
      state.auth.claims = claims;
      localStorage.setItem('doc_platform_token', token);

      updateAuthUI();
      showAppView();
      return;
    }
  } catch (e) {
    console.error('Failed to parse JWT payload', e);
  }

  signOut();
}

function updateAuthUI() {
  const userSpan = document.getElementById('current-user-name');
  const roleBadge = document.getElementById('user-role-badge');
  const roleSpan = document.getElementById('current-user-role');
  const claimsBox = document.getElementById('jwt-claims-container');

  if (state.auth.token && state.auth.claims) {
    const username = state.auth.claims['cognito:username'] || state.auth.claims.sub || 'Authenticated User';
    const groups = state.auth.claims['cognito:groups'] || state.auth.claims.roles || ['Document.Reader'];
    const primaryRole = groups[0] || 'Document.Reader';

    if (userSpan) userSpan.innerText = username;
    if (roleBadge) roleBadge.style.display = 'inline-flex';
    if (roleSpan) roleSpan.innerText = primaryRole;

    if (claimsBox) {
      claimsBox.innerText = JSON.stringify(
        {
          sub: state.auth.claims.sub,
          email: state.auth.claims.email,
          roles: groups,
          exp: new Date(state.auth.claims.exp * 1000).toLocaleString(),
          iss: state.auth.claims.iss,
          raw_jwt: state.auth.token,
        },
        null,
        2
      );
    }
  }
}

function signOut() {
  state.auth.token = '';
  state.auth.claims = null;
  localStorage.removeItem('doc_platform_token');
  showLoginView();
  showToast('Signed out of session. Access locked.', 'info');
}

function copyToken() {
  if (!state.auth.token) {
    showToast('No token to copy', 'warning');
    return;
  }
  navigator.clipboard.writeText(state.auth.token);
  showToast('JWT Token copied to clipboard!', 'success');
}

// ==========================================
// 3. API CLIENT HELPER & AUDIT LOGGING
// ==========================================
async function apiCall(method, path, body = null, customHeaders = {}) {
  const url = `${state.config.apiUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  const headers = {
    ...customHeaders,
  };

  if (state.auth.token) {
    headers['Authorization'] = `Bearer ${state.auth.token}`;
  }

  const startTime = performance.now();
  let responseData;
  let status = 0;

  try {
    const options = {
      method,
      headers,
    };

    if (body) {
      if (body instanceof Blob || body instanceof Uint8Array) {
        options.body = body;
      } else if (typeof body === 'object') {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      } else {
        options.body = body;
      }
    }

    const res = await fetch(url, options);
    status = res.status;
    const duration = Math.round(performance.now() - startTime);

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      responseData = await res.json();
    } else {
      responseData = await res.text();
    }

    logApiCall(method, url, headers, body, status, responseData, duration);

    if (!res.ok) {
      if (status === 401 || status === 403) {
        showToast('Session expired or unauthorized. Please re-authenticate.', 'danger');
      }
      const err = new Error(responseData?.error?.message || responseData?.message || `HTTP ${status}`);
      err.status = status;
      err.response = responseData;
      throw err;
    }

    return responseData;
  } catch (err) {
    const duration = Math.round(performance.now() - startTime);
    if (!responseData) {
      logApiCall(method, url, headers, body, status || 0, { error: err.message }, duration);
    }
    throw err;
  }
}

function logApiCall(method, url, headers, body, status, response, durationMs) {
  const curl = generateCurl(method, url, headers, body);
  state.auditLogs.unshift({
    timestamp: new Date().toLocaleTimeString(),
    method,
    url,
    status,
    durationMs,
    curl,
    response,
  });

  if (state.auditLogs.length > 50) state.auditLogs.pop();
  renderAuditLogs();
}

function generateCurl(method, url, headers, body) {
  let curl = `curl -X ${method} "${url}" \\\n`;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'authorization') {
      curl += `  -H "${k}: Bearer <JWT_TOKEN>" \\\n`;
    } else {
      curl += `  -H "${k}: ${v}" \\\n`;
    }
  }
  if (body && typeof body === 'object' && !(body instanceof Blob)) {
    curl += `  -d '${JSON.stringify(body)}'`;
  }
  return curl;
}

function renderAuditLogs() {
  const container = document.getElementById('audit-log-container');
  if (!container) return;

  if (state.auditLogs.length === 0) {
    container.innerHTML = `<div style="color: var(--text-dim); text-align: center; padding: 2rem;">No API calls logged yet.</div>`;
    return;
  }

  container.innerHTML = state.auditLogs
    .map((log) => {
      const badgeClass = log.status >= 200 && log.status < 300 ? 'badge-success' : log.status === 409 ? 'badge-warning' : 'badge-danger';
      return `
      <div class="card" style="margin-bottom: 0.75rem; padding: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="badge ${badgeClass}">${log.status}</span>
            <strong style="color: #ffffff;">${log.method}</strong>
            <span style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--text-muted);">${log.url}</span>
          </div>
          <div style="font-size: 0.75rem; color: var(--text-dim);">
            ${log.timestamp} • ${log.durationMs}ms
          </div>
        </div>
        <details>
          <summary style="cursor: pointer; font-size: 0.8rem; color: var(--aws-orange);">View cURL & Response Payload</summary>
          <div class="code-box" style="margin-top: 8px;">${log.curl}\n\n# Response [${log.status}]:\n${JSON.stringify(log.response, null, 2)}</div>
        </details>
      </div>`;
    })
    .join('');
}

function clearAuditLog() {
  state.auditLogs = [];
  renderAuditLogs();
  showToast('Audit log cleared', 'info');
}

// ==========================================
// 4. HEALTH CHECK
// ==========================================
async function checkHealth() {
  const healthBadge = document.getElementById('health-indicator');
  const healthText = document.getElementById('health-text');
  const healthCardStatus = document.getElementById('health-card-status');
  const healthCardLatency = document.getElementById('health-card-latency');
  const healthRaw = document.getElementById('health-raw-output');

  try {
    const t0 = performance.now();
    const data = await apiCall('GET', '/health');
    const latency = Math.round(performance.now() - t0);

    if (healthBadge) healthBadge.className = 'badge badge-success';
    if (healthText) healthText.innerText = 'Online';
    if (healthCardStatus) healthCardStatus.innerText = data.status || 'HEALTHY';
    if (healthCardLatency) healthCardLatency.innerText = `${latency} ms`;
    if (healthRaw) healthRaw.innerText = JSON.stringify(data, null, 2);
  } catch (err) {
    if (healthBadge) healthBadge.className = 'badge badge-danger';
    if (healthText) healthText.innerText = 'Degraded';
    if (healthCardStatus) healthCardStatus.innerText = 'OFFLINE';
    if (healthRaw) healthRaw.innerText = `Health check failed: ${err.message}`;
  }
}

// ==========================================
// 5. DOCUMENT INGESTION & DIRECT UPLOADS
// ==========================================
let selectedDirectFile = null;
let selectedInlineFile = null;

function handleDirectFileSelect(input) {
  if (input.files && input.files[0]) {
    selectedDirectFile = input.files[0];
    const info = document.getElementById('direct-file-info');
    info.innerHTML = `<span style="color: var(--color-success);">Selected: <strong>${selectedDirectFile.name}</strong> (${(selectedDirectFile.size / 1024).toFixed(1)} KB)</span>`;
  }
}

function handleInlineFileSelect(input) {
  if (input.files && input.files[0]) {
    selectedInlineFile = input.files[0];
  }
}

async function calculateSHA256(arrayBuffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const METADATA_TEMPLATES = {
  loan_agreement: {
    customer_id: 'IL-4492817',
    loan_number: 'LN-2026-88821',
    loan_amount_minor_units: 150000000,
    currency: 'ILS',
    loan_type: 'MORTGAGE',
    document_type: 'SIGNED_AGREEMENT',
    branch_code: 'TLV-01',
  },
  compliance_retention: {
    document_type: 'FINANCIAL_LEDGER',
    retention_schedule_code: 'RET-FIN-001',
    retention_period_years: 7,
    regulatory_framework: 'SOX',
    retention_start_date: '2026-08-26',
    retention_expiry_date: '2033-12-31',
    legal_hold_active: false,
    disposal_action: 'PERMANENT_DELETE',
    compliance_officer_id: 'COMP-OFFICER-01',
  },
  security_classification: {
    document_type: 'BOARD_RESOLUTION',
    confidentiality_tier: 'RESTRICTED',
    contains_pii: false,
    pii_categories: ['NONE'],
    minimum_clearance_role: 'Document.Reader',
    encryption_requirement: 'SSE_KMS_DEFAULT',
    data_residency_jurisdiction: 'IL',
    export_restricted: false,
    classification_owner: 'SEC-OPS-01',
  },
};

function onDirectClassChange(className) {
  const el = document.getElementById('direct-metadata');
  if (el && METADATA_TEMPLATES[className]) {
    el.value = JSON.stringify(METADATA_TEMPLATES[className], null, 2);
  }
}

function onInlineClassChange(className) {
  const el = document.getElementById('inline-metadata');
  if (el && METADATA_TEMPLATES[className]) {
    el.value = JSON.stringify(METADATA_TEMPLATES[className], null, 2);
  }
}

async function executeDirectUpload() {
  if (!selectedDirectFile) {
    showToast('Please select a document file first', 'warning');
    return;
  }

  const docClass = document.getElementById('direct-doc-class').value;
  let metadata = {};
  try {
    metadata = JSON.parse(document.getElementById('direct-metadata').value);
  } catch (e) {
    showToast('Invalid JSON in custom metadata', 'danger');
    return;
  }

  const progressContainer = document.getElementById('direct-progress-container');
  const progressBar = document.getElementById('direct-progress-bar');
  const progressStatus = document.getElementById('direct-progress-status');
  const progressPercent = document.getElementById('direct-progress-percent');
  const resultBox = document.getElementById('upload-result-box');

  progressContainer.style.display = 'block';
  progressBar.style.width = '10%';
  progressStatus.innerText = 'Computing SHA-256 client-side checksum...';
  progressPercent.innerText = '10%';

  try {
    const fileBytes = await selectedDirectFile.arrayBuffer();
    const checksum = await calculateSHA256(fileBytes);
    const contentType = selectedDirectFile.type || 'application/pdf';

    // 1. Initialize Direct Upload Session
    progressBar.style.width = '30%';
    progressStatus.innerText = 'Initializing upload session with API Gateway...';
    progressPercent.innerText = '30%';

    const initRes = await apiCall('POST', '/documents/uploads', {
      document_class: docClass,
      filename: selectedDirectFile.name,
      content_type: contentType,
      content_length: selectedDirectFile.size,
      checksum: `sha256:${checksum}`,
      metadata,
    });

    const { upload_id, upload_url, document_id } = initRes;

    // 2. Upload file directly to S3 via Presigned URL using XHR for progress tracking
    progressStatus.innerText = 'Streaming bytes directly into Amazon S3...';

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', upload_url);
      xhr.setRequestHeader('Content-Type', contentType);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round(30 + (e.loaded / e.total) * 50);
          progressBar.style.width = `${pct}%`;
          progressPercent.innerText = `${pct}%`;
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Direct S3 PUT failed with HTTP ${xhr.status}: ${xhr.responseText || xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error('S3 Direct Upload Network Error (Check S3 CORS permissions)'));
      xhr.send(selectedDirectFile);
    });

    // 3. Complete Upload Session
    progressBar.style.width = '90%';
    progressStatus.innerText = 'Committing DynamoDB pointers & S3 annotations...';
    progressPercent.innerText = '90%';

    const completeRes = await apiCall('POST', `/uploads/${upload_id}/complete`);

    progressBar.style.width = '100%';
    progressStatus.innerText = 'Upload Completed & Indexed!';
    progressPercent.innerText = '100%';

    state.activeDocument = { document_id, ...completeRes };
    resultBox.innerText = JSON.stringify(
      {
        status: 'SUCCESS',
        upload_type: 'DIRECT_S3_PRESIGNED',
        document_id,
        upload_id,
        completion: completeRes,
      },
      null,
      2
    );

    showToast(`Document uploaded successfully! ID: ${document_id}`, 'success');
  } catch (err) {
    progressContainer.style.display = 'none';
    const errDetails = err.response ? JSON.stringify(err.response, null, 2) : err.message;
    resultBox.innerText = `Upload Failed [HTTP ${err.status || 500}]:\n${errDetails}`;
    showToast(`Upload failed: ${err.message}`, 'danger');
  }
}

async function executeInlineUpload() {
  if (!selectedInlineFile) {
    showToast('Please select a file for inline upload', 'warning');
    return;
  }

  const docClass = document.getElementById('inline-doc-class').value;
  let metadata = {};
  try {
    metadata = JSON.parse(document.getElementById('inline-metadata').value);
  } catch (e) {
    showToast('Invalid JSON metadata', 'danger');
    return;
  }

  const resultBox = document.getElementById('upload-result-box');

  try {
    const fileBytes = await selectedInlineFile.arrayBuffer();
    const checksum = await calculateSHA256(fileBytes);
    const metadataHeader = btoa(JSON.stringify({ ...metadata, document_class: docClass, filename: selectedInlineFile.name }));

    const res = await apiCall('POST', '/documents', new Uint8Array(fileBytes), {
      'Content-Type': selectedInlineFile.type || 'application/pdf',
      'X-Document-Metadata': metadataHeader,
      'X-Content-SHA256': `sha256:${checksum}`,
    });

    state.activeDocument = res;
    resultBox.innerText = JSON.stringify(
      {
        status: 'SUCCESS',
        upload_type: 'INLINE_API_BASE64',
        response: res,
      },
      null,
      2
    );

    showToast(`Inline upload succeeded! ID: ${res.document_id}`, 'success');
  } catch (err) {
    resultBox.innerText = `Inline Upload Failed: ${err.message}\n${JSON.stringify(err.response || {}, null, 2)}`;
    showToast(`Inline upload failed: ${err.message}`, 'danger');
  }
}

function loadUploadedDocToViewer() {
  if (!state.activeDocument?.document_id) {
    showToast('No active document uploaded yet', 'warning');
    return;
  }
  const viewerInput = document.getElementById('viewer-doc-id');
  if (viewerInput) viewerInput.value = state.activeDocument.document_id;

  const tabBtn = document.querySelector('[data-tab="tab-viewer"]');
  if (tabBtn) tabBtn.click();
  fetchDocumentDetails();
}

// ==========================================
// 6. DOCUMENT VIEWER & PREVIEW
// ==========================================
async function fetchDocumentDetails(docId = null) {
  const targetId = docId || document.getElementById('viewer-doc-id').value.trim();
  if (!targetId) {
    showToast('Please enter a Document ID', 'warning');
    return;
  }

  try {
    showToast(`Fetching document ${targetId}...`, 'info');
    const doc = await apiCall('GET', `/documents/${targetId}`);
    state.activeDocument = doc;

    document.getElementById('viewer-details-section').style.display = 'block';
    document.getElementById('view-status-badge').innerText = doc.status;
    document.getElementById('view-app-version').innerText = `v${doc.current_application_version}`;
    document.getElementById('view-meta-revision').innerText = `rev ${doc.current_metadata_revision}`;
    document.getElementById('view-doc-class').innerText = doc.document_class;
    document.getElementById('viewer-metadata-box').innerText = JSON.stringify(doc.metadata || {}, null, 2);

    // Sync doc ID to other tabs
    const metaEditId = document.getElementById('meta-edit-doc-id');
    if (metaEditId) metaEditId.value = doc.document_id;
    const expectedRevInput = document.getElementById('meta-edit-expected-rev');
    if (expectedRevInput) expectedRevInput.value = doc.current_metadata_revision;

    const delId = document.getElementById('admin-delete-doc-id');
    if (delId) delId.value = doc.document_id;
    const resId = document.getElementById('admin-restore-doc-id');
    if (resId) resId.value = doc.document_id;

    // Load Preview
    const previewIframe = document.getElementById('doc-preview-iframe');
    const downloadBtn = document.getElementById('btn-download-file');
    if (doc.download_url) {
      previewIframe.src = doc.download_url;
      downloadBtn.href = doc.download_url;
    }

    fetchVersionHistory(targetId);
    showToast('Document details loaded', 'success');
  } catch (err) {
    showToast(`Fetch document failed: ${err.message}`, 'danger');
  }
}

async function fetchVersionHistory(docId = null) {
  const targetId = docId || state.activeDocument?.document_id || document.getElementById('viewer-doc-id').value.trim();
  if (!targetId) return;

  const tbody = document.getElementById('versions-tbody');
  try {
    const res = await apiCall('GET', `/documents/${targetId}/versions`);
    if (res.versions && res.versions.length > 0) {
      tbody.innerHTML = res.versions
        .map(
          (v) => `
        <tr>
          <td><strong>v${v.application_version}</strong></td>
          <td style="font-family: var(--font-mono); font-size: 0.75rem; color: #38bdf8;">${v.s3_version_id || 'latest'}</td>
          <td style="font-family: var(--font-mono); font-size: 0.75rem;">${(v.checksum || '').substring(0, 16)}...</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="downloadSpecificVersion('${targetId}', ${v.application_version})">⬇️ View</button>
          </td>
        </tr>
      `
        )
        .join('');
    } else {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">No previous versions</td></tr>`;
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--color-danger);">Failed to load versions: ${err.message}</td></tr>`;
  }
}

async function downloadSpecificVersion(docId, versionNum) {
  try {
    const res = await apiCall('GET', `/documents/${docId}/versions/${versionNum}`);
    if (res.download_url) {
      window.open(res.download_url, '_blank');
    }
  } catch (err) {
    showToast(`Failed to load version ${versionNum}: ${err.message}`, 'danger');
  }
}

// ==========================================
// 7. METADATA & CONCURRENCY EDITOR
// ==========================================
async function executeMetadataPatch() {
  const docId = document.getElementById('meta-edit-doc-id').value.trim();
  const expectedRev = parseInt(document.getElementById('meta-edit-expected-rev').value, 10);
  const resultBox = document.getElementById('metadata-patch-result');

  if (!docId) {
    showToast('Please specify a Document ID', 'warning');
    return;
  }

  let changes = {};
  try {
    changes = JSON.parse(document.getElementById('meta-edit-changes').value);
  } catch (e) {
    showToast('Invalid JSON in metadata changes', 'danger');
    return;
  }

  try {
    const res = await apiCall('PATCH', `/documents/${docId}/metadata`, {
      expected_metadata_revision: expectedRev,
      changes,
    });

    resultBox.innerText = JSON.stringify(res, null, 2);
    document.getElementById('meta-edit-expected-rev').value = res.metadata_revision;
    showToast(`Metadata updated to revision ${res.metadata_revision}!`, 'success');
  } catch (err) {
    resultBox.innerText = `PATCH ERROR [${err.status || 500}]:\n${JSON.stringify(err.response || { message: err.message }, null, 2)}`;
    showToast(`Metadata update error: ${err.message}`, 'danger');
  }
}

function simulateConflict() {
  const expectedRevInput = document.getElementById('meta-edit-expected-rev');
  expectedRevInput.value = '999'; // Stale revision guaranteed to conflict
  showToast('Revision set to 999 to simulate optimistic locking conflict (HTTP 409)', 'info');
  executeMetadataPatch();
}

// ==========================================
// 8. OPENSEARCH SEARCH
// ==========================================
function applySearchPreset(type, val = '') {
  const docClassEl = document.getElementById('search-doc-class');
  const customerIdEl = document.getElementById('search-customer-id');
  const docTypeEl = document.getElementById('search-doc-type');
  const loanNumberEl = document.getElementById('search-loan-number');
  const statusEl = document.getElementById('search-status');

  if (docClassEl) docClassEl.value = '';
  if (customerIdEl) customerIdEl.value = '';
  if (docTypeEl) docTypeEl.value = '';
  if (loanNumberEl) loanNumberEl.value = '';
  if (statusEl) statusEl.value = 'ACTIVE';

  if (type === 'all') {
    if (statusEl) statusEl.value = 'ALL';
  } else if (type === 'customer') {
    if (customerIdEl) customerIdEl.value = val;
  } else if (type === 'class') {
    if (docClassEl) docClassEl.value = val;
  }
  executeSearch();
}

function resetAndSearchAll() {
  const docClassEl = document.getElementById('search-doc-class');
  const customerIdEl = document.getElementById('search-customer-id');
  const docTypeEl = document.getElementById('search-doc-type');
  const loanNumberEl = document.getElementById('search-loan-number');
  const statusEl = document.getElementById('search-status');

  if (docClassEl) docClassEl.value = '';
  if (customerIdEl) customerIdEl.value = '';
  if (docTypeEl) docTypeEl.value = '';
  if (loanNumberEl) loanNumberEl.value = '';
  if (statusEl) statusEl.value = 'ALL';
  executeSearch();
}

async function executeSearch() {
  const docClass = document.getElementById('search-doc-class')?.value || '';
  const customerId = document.getElementById('search-customer-id')?.value?.trim() || '';
  const docType = document.getElementById('search-doc-type')?.value?.trim() || '';
  const loanNumber = document.getElementById('search-loan-number')?.value?.trim() || '';
  const status = document.getElementById('search-status')?.value || 'ACTIVE';
  const pageSize = parseInt(document.getElementById('search-page-size')?.value, 10) || 20;

  const filters = {};
  if (docClass) filters['document_class'] = docClass;
  if (customerId) filters['customer_id'] = customerId;
  if (docType) filters['document_type'] = docType;
  if (loanNumber) filters['loan_number'] = loanNumber;
  if (status && status !== 'ALL') filters['status'] = status;
  else if (status === 'ALL') filters['status'] = 'ALL';

  const tbody = document.getElementById('search-results-tbody');
  const countSpan = document.getElementById('search-total-count');
  const diagBox = document.getElementById('search-diagnostics-box');
  const diagContent = document.getElementById('search-diagnostics-content');

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 1.5rem;">🔍 Executing OpenSearch query...</td></tr>`;
  }

  try {
    const t0 = performance.now();
    const res = await apiCall('POST', '/search', {
      filters,
      page_size: pageSize,
    });
    const latency = Math.round(performance.now() - t0);

    const totalCount = res.total !== undefined ? res.total : (res.items ? res.items.length : 0);
    if (countSpan) countSpan.innerText = totalCount;

    if (diagBox && diagContent) {
      diagBox.style.display = 'block';
      diagContent.innerText = `HTTP 200 OK (${latency}ms) — Active Filters: ${JSON.stringify(filters)} — Total Results: ${totalCount}`;
    }

    if (res.items && res.items.length > 0) {
      tbody.innerHTML = res.items
        .map((doc) => {
          const descriptor = doc.customer_id ? `Cust: ${doc.customer_id}` : (doc.document_type || doc.filename || 'N/A');
          const dateStr = doc.created_at ? new Date(doc.created_at).toLocaleDateString() : 'N/A';
          const statusBadge = doc.status === 'ACTIVE' ? 'badge-success' : 'badge-danger';
          return `
            <tr>
              <td><code style="color: #38bdf8; font-size: 0.8rem;">${doc.document_id}</code></td>
              <td><span class="badge badge-info">${doc.document_class || 'loan_agreement'}</span></td>
              <td><span style="font-size: 0.82rem; color: #f8fafc;">${descriptor}</span></td>
              <td><span class="badge ${statusBadge}">${doc.status || 'ACTIVE'}</span></td>
              <td>v${doc.application_version || 1}</td>
              <td style="font-size: 0.8rem; color: var(--text-dim);">${dateStr}</td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="loadSearchedDoc('${doc.document_id}')">📂 Inspect</button>
              </td>
            </tr>
          `;
        })
        .join('');
    } else {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 1.5rem;">No documents matched the specified filters. Try selecting "All Document Classes" or clicking "Reset & View All".</td></tr>`;
    }
  } catch (err) {
    if (diagBox && diagContent) {
      diagBox.style.display = 'block';
      diagContent.innerText = `SEARCH ERROR [HTTP ${err.status || 500}]:\n${err.message}\nResponse: ${JSON.stringify(err.response || {}, null, 2)}`;
    }
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-danger); padding: 1.5rem;">Search failed: ${err.message}</td></tr>`;
    }
    showToast(`Search error: ${err.message}`, 'danger');
  }
}

function loadSearchedDoc(docId) {
  const viewerInput = document.getElementById('viewer-doc-id');
  if (viewerInput) viewerInput.value = docId;

  const tabBtn = document.querySelector('[data-tab="tab-viewer"]');
  if (tabBtn) tabBtn.click();
  fetchDocumentDetails(docId);
}

// ==========================================
// 9. ADMIN & LIFECYCLE
// ==========================================
async function executeSoftDelete() {
  const docId = document.getElementById('admin-delete-doc-id').value.trim();
  const resultBox = document.getElementById('admin-result-box');
  if (!docId) {
    showToast('Please enter a Document ID to soft delete', 'warning');
    return;
  }

  try {
    const res = await apiCall('POST', `/documents/${docId}/soft-delete`);
    resultBox.innerText = JSON.stringify(res, null, 2);
    showToast(`Document ${docId} soft deleted!`, 'success');
  } catch (err) {
    resultBox.innerText = `Soft delete error: ${err.message}\n${JSON.stringify(err.response || {}, null, 2)}`;
    showToast(`Soft delete error: ${err.message}`, 'danger');
  }
}

async function executeRestore() {
  const docId = document.getElementById('admin-restore-doc-id').value.trim();
  const resultBox = document.getElementById('admin-result-box');
  if (!docId) {
    showToast('Please enter a Document ID to restore', 'warning');
    return;
  }

  try {
    const res = await apiCall('POST', `/documents/${docId}/restore`);
    resultBox.innerText = JSON.stringify(res, null, 2);
    showToast(`Document ${docId} restored to ACTIVE!`, 'success');
  } catch (err) {
    resultBox.innerText = `Restore error: ${err.message}\n${JSON.stringify(err.response || {}, null, 2)}`;
    showToast(`Restore error: ${err.message}`, 'danger');
  }
}

// ==========================================
// 10. COST & TCO CALCULATOR (ISRAEL REGION)
// ==========================================
const PRICING_IL = {
  s3_storage_gb_mo: 0.025,
  s3_put_1k: 0.0055,
  s3_get_1k: 0.00044,
  dynamo_wru_million: 0.625,
  dynamo_rru_million: 0.125,
  dynamo_storage_gb_mo: 0.275,
  aoss_ocu_hr: 0.26,
  lambda_invocations_million: 0.2,
  lambda_gb_sec: 0.0000133334,
  api_gw_million: 3.8,
  cloudfront_gb: 0.0,
  kms_cmk_mo: 1.0,
  cloudwatch_logs_gb: 0.55,
  usd_to_ils_rate: 3.7,
};

function setCurrency(cur) {
  state.currency = cur;
  document.getElementById('btn-currency-usd').className = cur === 'USD' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
  document.getElementById('btn-currency-ils').className = cur === 'ILS' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
  updateCalculator();
}

function formatCost(valUsd) {
  if (state.currency === 'ILS') {
    const valIls = valUsd * PRICING_IL.usd_to_ils_rate;
    return `₪${valIls.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${valUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function updateCalculator() {
  const docsMonthly = parseInt(document.getElementById('slider-docs').value, 10);
  const avgSizeMb = parseFloat(document.getElementById('slider-size').value);
  const docsCumulative = parseInt(document.getElementById('slider-cumulative').value, 10);
  const queriesMonthly = parseInt(document.getElementById('slider-queries').value, 10);

  document.getElementById('slider-val-docs').innerText = `${docsMonthly.toLocaleString()} docs`;
  document.getElementById('slider-val-size').innerText = `${avgSizeMb.toFixed(1)} MB`;
  document.getElementById('slider-val-cumulative').innerText = `${docsCumulative.toLocaleString()} docs`;
  document.getElementById('slider-val-queries').innerText = `${queriesMonthly.toLocaleString()} queries`;

  // Storage
  const totalStorageGb = (docsCumulative * avgSizeMb) / 1024;
  const s3StorageCost = totalStorageGb * PRICING_IL.s3_storage_gb_mo;
  const s3PutCost = (docsMonthly * 2 * PRICING_IL.s3_put_1k) / 1000;
  const s3GetCost = (queriesMonthly * PRICING_IL.s3_get_1k) / 1000;
  const totalS3Cost = s3StorageCost + s3PutCost + s3GetCost;

  // DynamoDB
  const dynamoWruCost = ((docsMonthly * 4) / 1000000) * PRICING_IL.dynamo_wru_million;
  const dynamoRruCost = ((queriesMonthly * 2) / 1000000) * PRICING_IL.dynamo_rru_million;
  const dynamoStorageCost = Math.max(0.5, (docsCumulative * 2) / 1024 / 1024) * PRICING_IL.dynamo_storage_gb_mo;
  const totalDynamoCost = dynamoWruCost + dynamoRruCost + dynamoStorageCost;

  // OpenSearch Serverless
  const ocuCount = docsMonthly > 500000 ? 4.0 : 2.0;
  const aossCost = ocuCount * 730 * PRICING_IL.aoss_ocu_hr;

  // Lambda
  const lambdaInvocations = docsMonthly * 3 + queriesMonthly;
  const lambdaCost = (lambdaInvocations / 1000000) * PRICING_IL.lambda_invocations_million + lambdaInvocations * 0.15 * 0.5 * PRICING_IL.lambda_gb_sec;

  // API Gateway
  const apiGwCost = ((docsMonthly * 2 + queriesMonthly) / 1000000) * PRICING_IL.api_gw_million;

  // Static CloudFront + S3 SPA Frontend (100% Serverless)
  const cloudfrontSpaCost = 0.01;

  // KMS + Logs
  const logsAndKms = PRICING_IL.kms_cmk_mo + 5.0;

  const totalMonthlyUsd = totalS3Cost + totalDynamoCost + aossCost + lambdaCost + apiGwCost + cloudfrontSpaCost + logsAndKms;
  const costPerDocUsd = totalMonthlyUsd / Math.max(1, docsCumulative);

  // Update Summary Cards
  document.getElementById('calc-total-cost').innerText = formatCost(totalMonthlyUsd);
  document.getElementById('calc-total-cost-sub').innerText =
    state.currency === 'USD'
      ? `₪${(totalMonthlyUsd * PRICING_IL.usd_to_ils_rate).toFixed(2)} ILS / month`
      : `$${totalMonthlyUsd.toFixed(2)} USD / month`;
  document.getElementById('calc-unit-cost').innerText = formatCost(costPerDocUsd);
  document.getElementById('calc-total-storage').innerText = `${totalStorageGb.toFixed(1)} GB`;
  document.getElementById('calc-ocu-count').innerText = `${ocuCount.toFixed(1)} OCU`;

  // Breakdown Table
  const breakdownTbody = document.getElementById('calc-breakdown-tbody');
  if (breakdownTbody) {
    breakdownTbody.innerHTML = `
      <tr>
        <td><strong>Amazon OpenSearch Serverless</strong></td>
        <td>${ocuCount} OCUs baseline (${ocuCount / 2} Index + ${ocuCount / 2} Search)</td>
        <td style="text-align: right; font-family: var(--font-mono);">${formatCost(aossCost)}</td>
      </tr>
      <tr>
        <td><strong>Amazon S3 Standard</strong></td>
        <td>${totalStorageGb.toFixed(1)} GB storage + Annotations + API PUT/GET</td>
        <td style="text-align: right; font-family: var(--font-mono);">${formatCost(totalS3Cost)}</td>
      </tr>
      <tr>
        <td><strong>Amazon DynamoDB (On-Demand)</strong></td>
        <td>Pointers, sessions, versions, and optimistic lock checks</td>
        <td style="text-align: right; font-family: var(--font-mono);">${formatCost(totalDynamoCost)}</td>
      </tr>
      <tr>
        <td><strong>Amazon API Gateway</strong></td>
        <td>${((docsMonthly * 2 + queriesMonthly) / 1000).toFixed(0)}k REST requests / month</td>
        <td style="text-align: right; font-family: var(--font-mono);">${formatCost(apiGwCost)}</td>
      </tr>
      <tr>
        <td><strong>AWS Lambda (ARM64 Graviton)</strong></td>
        <td>${(lambdaInvocations / 1000).toFixed(0)}k executions (Avg 150ms @ 512MB)</td>
        <td style="text-align: right; font-family: var(--font-mono);">${formatCost(lambdaCost)}</td>
      </tr>
      <tr>
        <td><strong>Serverless UI (CloudFront + S3 SPA)</strong></td>
        <td>Global Edge CDN Distribution + S3 Web Bucket (0 Idle Cost)</td>
        <td style="text-align: right; font-family: var(--font-mono); color: var(--color-success);">${formatCost(cloudfrontSpaCost)}</td>
      </tr>
      <tr>
        <td><strong>AWS KMS & CloudWatch</strong></td>
        <td>Platform CMK + Structured JSON telemetry logs</td>
        <td style="text-align: right; font-family: var(--font-mono);">${formatCost(logsAndKms)}</td>
      </tr>
    `;
  }
}

// Auto-run on DOM ready
document.addEventListener('DOMContentLoaded', initApp);
