// AWS Document Management Platform — Serverless SPA Client Logic

// Global Application State
const state = {
  config: {
    apiUrl: '',
    agentStreamingUrl: '',
    userPoolId: '',
    userPoolClientId: '',
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
  auditSubTab: 'llm',
  ai: {
    sessionId: '',
    messages: [],
    isStreaming: false,
    abortController: null,
    streamingUrl: localStorage.getItem('doc_platform_agent_streaming_url') || '',
  },
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
    console.warn('Unable to load runtime config.json:', err);
  }

  if (!state.config.apiUrl || state.config.apiUrl.includes('<api-id>')) {
    console.warn('Frontend configuration is using placeholder values. Please update config.json with deployed AWS resource endpoints.');
  }

  const regionSpan = document.getElementById('health-card-region');
  if (regionSpan) regionSpan.innerText = state.config.region;

  // Initialize AI Conversational Assistant
  initAiAssistant();

  // Check and restore active auth session
  if (state.auth.token) {
    const valid = parseAndSetToken(state.auth.token);
    if (!valid && localStorage.getItem('doc_platform_refresh_token')) {
      refreshCognitoToken().then((newToken) => {
        if (!newToken) {
          signOut();
        }
      });
    }
  } else {
    showLoginView();
  }

  // Run cost calculator & health
  updateCalculator();

  // Initialize upload AI enrichment advisors
  updateEnrichmentAdvisor('direct');
  updateEnrichmentAdvisor('inline');
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

  if (data.AuthenticationResult?.RefreshToken) {
    localStorage.setItem('doc_platform_refresh_token', data.AuthenticationResult.RefreshToken);
  }
  return token;
}

async function refreshCognitoToken() {
  const refreshToken = localStorage.getItem('doc_platform_refresh_token');
  if (!refreshToken || !state.config.userPoolClientId) return null;

  try {
    const endpoint = `https://cognito-idp.${state.config.region}.amazonaws.com/`;
    const payload = {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: state.config.userPoolClientId,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
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
    if (res.ok && data.AuthenticationResult) {
      const newToken = data.AuthenticationResult.IdToken || data.AuthenticationResult.AccessToken;
      if (newToken) {
        console.log('Cognito token refreshed silently via REFRESH_TOKEN_AUTH');
        parseAndSetToken(newToken);
        return newToken;
      }
    } else {
      console.warn('Silent refresh rejected by Cognito:', data);
    }
  } catch (err) {
    console.warn('Silent token refresh network error:', err);
  }
  return null;
}

async function ensureValidToken() {
  if (!state.auth.token) return null;

  if (state.auth.claims && state.auth.claims.exp) {
    const expiresAtMs = state.auth.claims.exp * 1000;
    const nowMs = Date.now();
    // Refresh proactively if expired or expiring within 2 minutes (120 seconds)
    if (expiresAtMs - nowMs < 120000) {
      console.log('Token expiring soon or expired, refreshing silently...');
      const refreshed = await refreshCognitoToken();
      if (refreshed) return refreshed;
    }
  }
  return state.auth.token;
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
        return false;
      }

      state.auth.token = token;
      state.auth.claims = claims;
      localStorage.setItem('doc_platform_token', token);

      updateAuthUI();
      showAppView();
      return true;
    }
  } catch (e) {
    console.error('Failed to parse JWT payload', e);
  }

  signOut();
  return false;
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
  localStorage.removeItem('doc_platform_refresh_token');
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
async function apiCall(method, path, body = null, customHeaders = {}, isRetry = false) {
  await ensureValidToken();

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
      const isExpired = status === 401 || (typeof responseData === 'object' && responseData?.message && responseData.message.includes('expired'));
      if (isExpired && !isRetry) {
        console.warn('API returned token expired, attempting silent refresh & retry...');
        const refreshed = await refreshCognitoToken();
        if (refreshed) {
          return apiCall(method, path, body, customHeaders, true);
        }
        showToast('Session expired. Please sign in again.', 'danger');
        signOut();
      } else if (status === 401 || status === 403) {
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

function setAuditSubTab(subTab) {
  state.auditSubTab = subTab;
  const btnLlm = document.getElementById('btn-subtab-llm');
  const btnLifecycle = document.getElementById('btn-subtab-lifecycle');
  const btnBoth = document.getElementById('btn-subtab-both');
  const panelLlm = document.getElementById('audit-panel-llm');
  const panelLifecycle = document.getElementById('audit-panel-lifecycle');
  const container = document.getElementById('audit-panels-container');

  if (btnLlm) btnLlm.classList.toggle('active', subTab === 'llm');
  if (btnLifecycle) btnLifecycle.classList.toggle('active', subTab === 'lifecycle');
  if (btnBoth) btnBoth.classList.toggle('active', subTab === 'both');

  if (subTab === 'llm') {
    if (panelLlm) panelLlm.style.display = 'block';
    if (panelLifecycle) panelLifecycle.style.display = 'none';
    if (container) container.className = '';
  } else if (subTab === 'lifecycle') {
    if (panelLlm) panelLlm.style.display = 'none';
    if (panelLifecycle) panelLifecycle.style.display = 'block';
    if (container) container.className = '';
  } else if (subTab === 'both') {
    if (panelLlm) panelLlm.style.display = 'block';
    if (panelLifecycle) panelLifecycle.style.display = 'block';
    if (container) container.className = 'audit-split-view';
  }
}

async function fetchDocumentAudit(docId) {
  if (!docId) return;
  const auditDocIdInput = document.getElementById('audit-doc-id');
  if (auditDocIdInput) auditDocIdInput.value = docId;

  const emptyState = document.getElementById('audit-llm-empty-state');
  const contentContainer = document.getElementById('audit-llm-content-container');
  const badgesContainer = document.getElementById('audit-doc-badges');

  try {
    const data = await apiCall('GET', `/documents/${encodeURIComponent(docId)}/audit`);
    if (!data) return;

    // 1. Update Context Badges
    if (badgesContainer) badgesContainer.style.display = 'flex';
    const statusEl = document.getElementById('audit-doc-status');
    if (statusEl) {
      statusEl.className = data.status === 'ACTIVE' ? 'badge badge-success' : 'badge badge-danger';
      statusEl.innerText = data.status;
    }
    const classEl = document.getElementById('audit-doc-class');
    if (classEl) classEl.innerText = data.document_class || '-';
    const verEl = document.getElementById('audit-doc-version');
    if (verEl) verEl.innerText = `v${data.current_application_version || 1}`;
    const revEl = document.getElementById('audit-doc-revision');
    if (revEl) revEl.innerText = `rev ${data.current_metadata_revision || 1}`;

    // 2. Render LLM Enrichment Audit (Kind 1)
    const llm = data.llm_enrichment_audit || {};
    if (emptyState) emptyState.style.display = 'none';
    if (contentContainer) contentContainer.style.display = 'block';

    const statusBadge = document.getElementById('audit-llm-status-badge');
    if (statusBadge) {
      if (llm.status === 'ENRICHED') {
        statusBadge.className = 'badge badge-success';
        statusBadge.innerText = 'Bedrock Audited';
      } else if (llm.status === 'QUEUED') {
        statusBadge.className = 'badge badge-warning';
        statusBadge.innerText = 'Queued in SQS';
      } else if (llm.status === 'SKIPPED') {
        statusBadge.className = 'badge badge-secondary';
        statusBadge.innerText = 'Enrichment Skipped';
      } else {
        statusBadge.className = 'badge badge-secondary';
        statusBadge.innerText = 'Not Enriched';
      }
    }

    const latencyBadge = document.getElementById('audit-llm-latency-badge');
    if (latencyBadge) {
      latencyBadge.innerText = `${llm.latency_ms || 0} ms`;
    }

    const modelEl = document.getElementById('audit-llm-model');
    if (modelEl) modelEl.innerText = llm.model_id || 'Claude 3 Haiku';

    const tokensEl = document.getElementById('audit-llm-tokens');
    if (tokensEl) tokensEl.innerText = (llm.total_tokens || 0).toLocaleString();

    const tokensSubEl = document.getElementById('audit-llm-tokens-sub');
    if (tokensSubEl) {
      tokensSubEl.innerText = `${(llm.prompt_tokens || 0).toLocaleString()} in / ${(llm.completion_tokens || 0).toLocaleString()} out`;
    }

    const latencyEl = document.getElementById('audit-llm-latency');
    if (latencyEl) latencyEl.innerText = `${llm.latency_ms || 0} ms`;

    const timeEl = document.getElementById('audit-llm-time');
    if (timeEl) {
      timeEl.innerText = llm.applied_at ? new Date(llm.applied_at).toLocaleString() : '-';
    }

    const piiBadge = document.getElementById('audit-llm-pii-badge');
    if (piiBadge) {
      if (llm.contains_pii) {
        piiBadge.className = 'badge badge-danger';
        piiBadge.innerText = '⚠️ YES (PII Detected)';
      } else {
        piiBadge.className = 'badge badge-success';
        piiBadge.innerText = '✅ NO PII';
      }
    }

    const piiCatsEl = document.getElementById('audit-llm-pii-cats');
    if (piiCatsEl) {
      const cats = llm.pii_categories || [];
      if (Array.isArray(cats) && cats.length > 0) {
        piiCatsEl.innerHTML = cats.map(c => `<span class="badge badge-warning" style="font-size: 0.75rem;">${c}</span>`).join(' ');
      } else {
        piiCatsEl.innerHTML = '<span style="font-size: 0.8rem; color: var(--text-dim);">No PII categories identified</span>';
      }
    }

    const s3PathEl = document.getElementById('audit-llm-s3-path');
    if (s3PathEl) {
      s3PathEl.innerText = llm.s3_audit_uri || llm.s3_audit_key || '-';
    }

    const rawBox = document.getElementById('audit-llm-raw-box');
    if (rawBox) {
      rawBox.innerText = JSON.stringify(llm.raw_record || llm, null, 2);
    }

    // 3. Render Lifecycle & System Audit (Kind 2)
    const lifecycle = data.lifecycle_audit || {};
    const versionsTbody = document.getElementById('audit-lifecycle-versions-tbody');
    if (versionsTbody) {
      const versions = lifecycle.versions || [];
      if (versions.length === 0) {
        versionsTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-dim);">No version records found</td></tr>';
      } else {
        versionsTbody.innerHTML = versions
          .map(
            (v) => `<tr>
              <td><span class="badge badge-info">v${v.application_version}</span></td>
              <td style="font-family: var(--font-mono); font-size: 0.8rem;">${v.s3_version_id || '-'}</td>
              <td style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted);">${v.content_checksum || '-'}</td>
              <td><span class="badge ${v.state === 'ACTIVE' ? 'badge-success' : 'badge-danger'}">${v.state || 'ACTIVE'}</span></td>
            </tr>`
          )
          .join('');
      }
    }

    const eventsContainer = document.getElementById('audit-lifecycle-events-container');
    if (eventsContainer) {
      const events = lifecycle.system_events || [];
      if (events.length === 0) {
        eventsContainer.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 1.5rem;">No lifecycle events found.</div>';
      } else {
        eventsContainer.innerHTML = events
          .map(
            (evt) => `<div class="audit-timeline-item">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <strong style="color: #ffffff; font-size: 0.85rem;">${evt.description || evt.event_type}</strong>
                <span style="font-size: 0.75rem; color: var(--text-dim);">${evt.timestamp ? new Date(evt.timestamp).toLocaleString() : '-'}</span>
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">
                Actor: <span class="badge badge-role" style="font-size: 0.65rem; padding: 1px 6px;">${evt.actor || 'system'}</span>
                ${evt.details ? `• <span style="font-family: var(--font-mono);">${JSON.stringify(evt.details)}</span>` : ''}
              </div>
            </div>`
          )
          .join('');
      }
    }

    showToast('Document audit trail loaded', 'success');
  } catch (err) {
    showToast(`Failed to load audit: ${err.message}`, 'danger');
  }
}

function fetchDocumentAuditFromInput() {
  const input = document.getElementById('audit-doc-id');
  const id = input ? input.value.trim() : '';
  if (!id) {
    showToast('Please enter a Document ID', 'warning');
    return;
  }
  fetchDocumentAudit(id);
}

function loadActiveDocumentIntoAudit() {
  if (state.activeDocument && state.activeDocument.document_id) {
    const input = document.getElementById('audit-doc-id');
    if (input) input.value = state.activeDocument.document_id;
    fetchDocumentAudit(state.activeDocument.document_id);
  } else {
    showToast('No active document loaded in viewer. Enter a Document UUID.', 'warning');
  }
}

function copyAuditS3Uri() {
  const el = document.getElementById('audit-llm-s3-path');
  if (el && el.innerText && el.innerText !== '-') {
    navigator.clipboard.writeText(el.innerText);
    showToast('S3 Compliance URI copied to clipboard', 'info');
  }
}

function exportAuditLogs() {
  if (state.auditLogs.length === 0) {
    showToast('No audit logs to export', 'warning');
    return;
  }
  const blob = new Blob([JSON.stringify(state.auditLogs, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `doc-platform-audit-logs-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('Audit log JSON exported', 'success');
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

const SHARED_BASE_TEMPLATE = window.SHARED_BASE_TEMPLATE || {};
const CLASS_SPECIFIC_TEMPLATES = window.CLASS_SPECIFIC_TEMPLATES || {};
const METADATA_TEMPLATES = window.METADATA_TEMPLATES || {};

function parseJsonRelaxed(str) {
  if (!str || typeof str !== 'string' || !str.trim()) return {};
  const trimmed = str.trim();
  try {
    return JSON.parse(trimmed);
  } catch (err1) {
    try {
      const sanitized = trimmed
        .replace(/,\s*([}\]])/g, '$1') // remove trailing commas
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // ensure quoted keys
        .replace(/'/g, '"');
      return JSON.parse(sanitized);
    } catch (err2) {
      throw new Error(err1.message);
    }
  }
}

function resetDirectSharedMeta() {
  const el = document.getElementById('direct-shared-metadata');
  if (el) el.value = JSON.stringify(SHARED_BASE_TEMPLATE, null, 2);
  showToast('Shared metadata reset to default template', 'info');
}

function resetDirectClassMeta() {
  const docClass = document.getElementById('direct-doc-class')?.value || 'loan_agreement';
  const el = document.getElementById('direct-class-metadata');
  if (el && CLASS_SPECIFIC_TEMPLATES[docClass]) {
    el.value = JSON.stringify(CLASS_SPECIFIC_TEMPLATES[docClass], null, 2);
    showToast(`Class metadata reset to ${docClass} template`, 'info');
  }
}

function resetInlineSharedMeta() {
  const el = document.getElementById('inline-shared-metadata');
  if (el) el.value = JSON.stringify(SHARED_BASE_TEMPLATE, null, 2);
  showToast('Shared metadata reset to default template', 'info');
}

function resetInlineClassMeta() {
  const docClass = document.getElementById('inline-doc-class')?.value || 'loan_agreement';
  const el = document.getElementById('inline-class-metadata');
  if (el && CLASS_SPECIFIC_TEMPLATES[docClass]) {
    el.value = JSON.stringify(CLASS_SPECIFIC_TEMPLATES[docClass], null, 2);
    showToast(`Class metadata reset to ${docClass} template`, 'info');
  }
}

function openTriggerRulesModal() {
  const modal = document.getElementById('trigger-rules-modal');
  if (modal) {
    if (typeof modal.showModal === 'function') {
      modal.showModal();
    } else {
      modal.style.display = 'block';
    }
  }
}

function onEnrichmentToggle(mode, checked) {
  const prefix = mode === 'direct' ? 'direct' : 'inline';
  const classEl = document.getElementById(`${prefix}-class-metadata`);
  if (classEl) {
    try {
      const meta = parseJsonRelaxed(classEl.value);
      if (!checked) {
        meta.skip_enrichment = true;
      } else {
        delete meta.skip_enrichment;
      }
      classEl.value = JSON.stringify(meta, null, 2);
    } catch {}
  }
  updateEnrichmentAdvisor(mode);
}

function updateEnrichmentAdvisor(mode = 'direct') {
  const prefix = mode === 'direct' ? 'direct' : 'inline';
  const checkbox = document.getElementById(`${prefix}-enable-enrichment`);
  const guideEl = document.getElementById(`${prefix}-enrichment-guide`);
  if (!guideEl) return;

  const classSelect = document.getElementById(`${prefix}-doc-class`);
  const docClass = classSelect ? classSelect.value : 'loan_agreement';

  let classMeta = {};
  let sharedMeta = {};
  try {
    const rawClass = document.getElementById(`${prefix}-class-metadata`)?.value || '{}';
    classMeta = parseJsonRelaxed(rawClass);
  } catch {}
  try {
    const rawShared = document.getElementById(`${prefix}-shared-metadata`)?.value || '{}';
    sharedMeta = parseJsonRelaxed(rawShared);
  } catch {}

  const meta = { ...sharedMeta, ...classMeta };

  if (meta.skip_enrichment === true && checkbox && checkbox.checked) {
    checkbox.checked = false;
  } else if (meta.skip_enrichment === false && checkbox && !checkbox.checked) {
    checkbox.checked = true;
  }

  const isEnabled = checkbox ? checkbox.checked && meta.skip_enrichment !== true : meta.skip_enrichment !== true;

  if (!isEnabled) {
    guideEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px; color: #f87171; margin-bottom: 4px;">
        <span>🚫</span> <strong>Enrichment Bypassed:</strong> <code>skip_enrichment: true</code> flag active.
      </div>
      <div>Zero Bedrock tokens will be consumed. Document will be ingested as Revision 1 and will not queue into SQS.</div>
    `;
    return;
  }

  let triggerHtml = `
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="color: #4ade80;">✅</span>
        <span><strong>Trigger Condition Met:</strong> New document ingestion (Revision 1) automatically enqueues into <code>doc-platform-mvp-enrichment-queue</code>.</span>
      </div>
  `;

  if (docClass === 'loan_agreement') {
    const hasLoanNum = Boolean(meta.loan_number && String(meta.loan_number).trim());
    if (hasLoanNum) {
      triggerHtml += `
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="color: #38bdf8;">ℹ️</span>
          <span><strong>Pre-flight Token Optimization:</strong> <code>loan_number</code> ("${meta.loan_number}") is provided. Attribute extraction skipped to save tokens; only PII scan will run.</span>
        </div>
      `;
    } else {
      triggerHtml += `
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="color: #fbbf24;">⚡</span>
          <span><strong>Attribute Auto-Extraction:</strong> <code>loan_number</code> is blank. Bedrock Claude 3 Haiku will extract loan reference, amount, currency, and signed date from document text.</span>
        </div>
      `;
    }
  } else if (docClass === 'compliance_retention') {
    const hasSched = Boolean(meta.retention_schedule_code && String(meta.retention_schedule_code).trim());
    if (hasSched) {
      triggerHtml += `
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="color: #38bdf8;">ℹ️</span>
          <span><strong>Pre-flight Token Optimization:</strong> Retention schedule code ("${meta.retention_schedule_code}") is provided. Attribute extraction skipped; only PII scan will run.</span>
        </div>
      `;
    } else {
      triggerHtml += `
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="color: #fbbf24;">⚡</span>
          <span><strong>Attribute Auto-Extraction:</strong> Retention schedule code and regulatory framework will be classified by AI.</span>
        </div>
      `;
    }
  } else if (docClass === 'security_classification') {
    triggerHtml += `
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="color: #fbbf24;">🛡️</span>
        <span><strong>PII Discovery & Categorization:</strong> Scans text for National IDs, Financial Accounts, and Biometric references with non-downgrade safety ratchet.</span>
      </div>
    `;
  }

  triggerHtml += `
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="color: #a78bfa;">🔒</span>
        <span><strong>Governance Boundary:</strong> Sensitivity tier & clearance roles are 100% uploader-governed and cannot be altered or downgraded by AI.</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; font-size: 0.73rem; color: var(--text-dim); margin-top: 2px;">
        <span>⏱️</span>
        <span>Upload returns in &lt;200ms. Bedrock completes asynchronously in ~1.5s, bumping revision 1 ➔ 2 via DynamoDB OCC.</span>
      </div>
    </div>
  `;

  guideEl.innerHTML = triggerHtml;
}

function onDirectClassChange(className) {
  const badge = document.getElementById('direct-class-badge');
  if (badge) badge.innerText = className;

  const classEl = document.getElementById('direct-class-metadata');
  if (classEl && CLASS_SPECIFIC_TEMPLATES[className]) {
    classEl.value = JSON.stringify(CLASS_SPECIFIC_TEMPLATES[className], null, 2);
  }
  updateEnrichmentAdvisor('direct');
}

function onInlineClassChange(className) {
  const badge = document.getElementById('inline-class-badge');
  if (badge) badge.innerText = className;

  const classEl = document.getElementById('inline-class-metadata');
  if (classEl && CLASS_SPECIFIC_TEMPLATES[className]) {
    classEl.value = JSON.stringify(CLASS_SPECIFIC_TEMPLATES[className], null, 2);
  }
  updateEnrichmentAdvisor('inline');
}

async function executeDirectUpload() {
  if (!selectedDirectFile) {
    showToast('Please select a document file first', 'warning');
    return;
  }

  const docClass = document.getElementById('direct-doc-class').value;
  let sharedMeta = {};
  let classMeta = {};

  try {
    const sharedRaw = document.getElementById('direct-shared-metadata')?.value || '{}';
    sharedMeta = parseJsonRelaxed(sharedRaw);
  } catch (e) {
    showToast(`Invalid JSON in Shared Metadata: ${e.message}`, 'danger');
    return;
  }

  try {
    const classRaw = document.getElementById('direct-class-metadata')?.value || '{}';
    classMeta = parseJsonRelaxed(classRaw);
  } catch (e) {
    showToast(`Invalid JSON in Class Metadata: ${e.message}`, 'danger');
    return;
  }

  const metadata = { ...sharedMeta, ...classMeta };
  const directEnableEl = document.getElementById('direct-enable-enrichment');
  if (directEnableEl && !directEnableEl.checked) {
    metadata.skip_enrichment = true;
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
  let sharedMeta = {};
  let classMeta = {};

  try {
    const sharedRaw = document.getElementById('inline-shared-metadata')?.value || '{}';
    sharedMeta = parseJsonRelaxed(sharedRaw);
  } catch (e) {
    showToast(`Invalid JSON in Shared Metadata: ${e.message}`, 'danger');
    return;
  }

  try {
    const classRaw = document.getElementById('inline-class-metadata')?.value || '{}';
    classMeta = parseJsonRelaxed(classRaw);
  } catch (e) {
    showToast(`Invalid JSON in Class Metadata: ${e.message}`, 'danger');
    return;
  }

  const metadata = { ...sharedMeta, ...classMeta };
  const inlineEnableEl = document.getElementById('inline-enable-enrichment');
  if (inlineEnableEl && !inlineEnableEl.checked) {
    metadata.skip_enrichment = true;
  }

  const resultBox = document.getElementById('upload-result-box');

  try {
    const fileBytes = await selectedInlineFile.arrayBuffer();
    const checksum = await calculateSHA256(fileBytes);
    const metaPayload = JSON.stringify({ ...metadata, document_class: docClass, filename: selectedInlineFile.name });
    const metadataHeader = btoa(unescape(encodeURIComponent(metaPayload)));

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
function isConvertibleFormat(doc) {
  if (!doc) return false;
  const contentType = (doc.metadata?.content_type || doc.content_type || '').toLowerCase();
  const filename = (doc.metadata?.filename || doc.filename || '').toLowerCase();
  if (contentType === 'application/pdf' || filename.endsWith('.pdf')) {
    return false;
  }
  return (
    contentType === 'image/jpeg' ||
    contentType === 'image/jpg' ||
    contentType === 'image/png' ||
    contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    contentType === 'application/docx' ||
    contentType === 'application/msword' ||
    filename.endsWith('.jpg') ||
    filename.endsWith('.jpeg') ||
    filename.endsWith('.png') ||
    filename.endsWith('.docx') ||
    filename.endsWith('.doc')
  );
}

const isConvertibleImage = isConvertibleFormat;

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

    // AI Enrichment Audit Presentation (Viewer Card & Audit Tab)
    const aiViewerCard = document.getElementById('viewer-ai-audit-card');
    const aiStatusBadge = document.getElementById('ai-audit-status-badge');
    const aiLatencyBadge = document.getElementById('ai-audit-latency-badge');
    const aiGrid = document.getElementById('ai-audit-grid');
    const aiCats = document.getElementById('ai-audit-cats');
    const aiMsg = document.getElementById('ai-audit-message');
    const aiDiagnosis = document.getElementById('ai-audit-diagnosis');
    const step1 = document.getElementById('step-1-ingest');
    const step2 = document.getElementById('step-2-sqs');
    const step3 = document.getElementById('step-3-bedrock');
    const step4 = document.getElementById('step-4-occ');
    const auditTabAiCard = document.getElementById('audit-tab-ai-enrichment-card');
    const auditTabAiContent = document.getElementById('audit-tab-ai-content');

    const audit = doc.metadata?.enrichment_audit;
    const isEnriched = Boolean(audit || doc.metadata?.metadata_updated_by === 'system:llm-enricher');
    const isSkipped = doc.metadata?.skip_enrichment === true;
    const isVersionMutation = doc.current_application_version > 1;
    const isManualPatch = !isEnriched && !isSkipped && doc.current_metadata_revision > 1;
    const isPending = !isEnriched && !isSkipped && !isVersionMutation && doc.current_metadata_revision === 1;

    if (aiViewerCard) {
      aiViewerCard.style.display = 'block';

      if (isEnriched && audit) {
        if (aiGrid) aiGrid.style.display = 'grid';
        if (aiCats) aiCats.style.display = 'block';
        if (aiMsg) aiMsg.style.display = 'none';

        if (aiStatusBadge) {
          aiStatusBadge.className = 'badge badge-success';
          aiStatusBadge.innerText = 'Enriched by Bedrock';
        }
        if (aiLatencyBadge) {
          aiLatencyBadge.style.display = 'inline-block';
          aiLatencyBadge.innerText = `${audit.latency_ms || 0} ms`;
        }
        if (step1) { step1.className = 'badge badge-success'; step1.innerText = '✓ 1. Ingestion (v1)'; }
        if (step2) { step2.className = 'badge badge-success'; step2.innerText = '✓ 2. SQS Dispatched'; }
        if (step3) { step3.className = 'badge badge-success'; step3.innerText = '✓ 3. Bedrock Scanned'; }
        if (step4) { step4.className = 'badge badge-success'; step4.innerText = `✓ 4. Rev ${doc.current_metadata_revision} Committed`; }

        if (aiDiagnosis) {
          aiDiagnosis.innerHTML = `
            <div style="display: flex; align-items: center; gap: 6px; color: #4ade80;">
              <span>🟢</span> <strong>Enrichment Completed:</strong> Automatically triggered on initial ingestion (Rev 1 ➔ 2).
            </div>
            <div style="color: var(--text-dim); margin-top: 2px;">
              Bedrock Claude 3 Haiku extracted missing attributes, unioned newly identified PII into S3 annotations, and atomically bumped revision via DynamoDB OCC.
            </div>
          `;
        }

        const modelEl = document.getElementById('ai-audit-model');
        if (modelEl) modelEl.innerText = audit.model_id || 'Claude 3 Haiku';

        const tokensEl = document.getElementById('ai-audit-tokens');
        if (tokensEl) {
          tokensEl.innerText = `${(audit.total_tokens || 0).toLocaleString()} (${audit.prompt_tokens || 0} in / ${audit.completion_tokens || 0} out)`;
        }

        const piiEl = document.getElementById('ai-audit-pii');
        if (piiEl) {
          piiEl.innerHTML = doc.metadata?.contains_pii
            ? '<span class="badge badge-danger">YES (PII Detected)</span>'
            : '<span class="badge badge-success">NO PII</span>';
        }

        const timeEl = document.getElementById('ai-audit-time');
        if (timeEl) {
          timeEl.innerText = audit.applied_at ? new Date(audit.applied_at).toLocaleTimeString() : '-';
        }

        const catContainer = document.getElementById('ai-audit-categories-container');
        if (catContainer) {
          const cats = doc.metadata?.pii_categories || [];
          if (Array.isArray(cats) && cats.length > 0) {
            catContainer.innerHTML = cats.map(c => `<span class="badge badge-warning" style="font-size: 0.75rem;">${c}</span>`).join(' ');
          } else {
            catContainer.innerHTML = '<span style="font-size: 0.75rem; color: var(--text-dim);">None identified</span>';
          }
        }
      } else if (isSkipped) {
        if (aiGrid) aiGrid.style.display = 'none';
        if (aiCats) aiCats.style.display = 'none';
        if (aiMsg) aiMsg.style.display = 'none';
        if (aiStatusBadge) {
          aiStatusBadge.className = 'badge badge-secondary';
          aiStatusBadge.innerText = 'Bypassed (Cost Guardrail)';
        }
        if (aiLatencyBadge) aiLatencyBadge.style.display = 'none';

        if (step1) { step1.className = 'badge badge-success'; step1.innerText = '✓ 1. Ingestion (v1)'; }
        if (step2) { step2.className = 'badge badge-secondary'; step2.innerText = '⊘ 2. SQS Bypassed'; }
        if (step3) { step3.className = 'badge badge-secondary'; step3.innerText = '⊘ 3. Bedrock Skipped'; }
        if (step4) { step4.className = 'badge badge-secondary'; step4.innerText = '✓ 4. Rev 1 Preserved'; }

        if (aiDiagnosis) {
          aiDiagnosis.innerHTML = `
            <div style="display: flex; align-items: center; gap: 6px; color: #94a3b8;">
              <span>⚪</span> <strong>Enrichment Bypassed:</strong> Document was flagged with <code>skip_enrichment=true</code>.
            </div>
            <div style="color: var(--text-dim); margin-top: 2px;">
              Amazon Bedrock invocation was completely bypassed to conserve tokens. Zero Bedrock tokens were consumed.
            </div>
          `;
        }
      } else if (isVersionMutation) {
        if (aiGrid) aiGrid.style.display = 'none';
        if (aiCats) aiCats.style.display = 'none';
        if (aiMsg) aiMsg.style.display = 'none';
        if (aiStatusBadge) {
          aiStatusBadge.className = 'badge badge-info';
          aiStatusBadge.innerText = `Content Version ${doc.current_application_version}`;
        }
        if (aiLatencyBadge) aiLatencyBadge.style.display = 'none';

        if (step1) { step1.className = 'badge badge-success'; step1.innerText = '✓ 1. Ingestion (v1)'; }
        if (step2) { step2.className = 'badge badge-info'; step2.innerText = `✓ 2. Content v${doc.current_application_version}`; }
        if (step3) { step3.className = 'badge badge-secondary'; step3.innerText = '⊘ 3. Bedrock (No-op)'; }
        if (step4) { step4.className = 'badge badge-info'; step4.innerText = `✓ 4. Version ${doc.current_application_version} Active`; }

        if (aiDiagnosis) {
          aiDiagnosis.innerHTML = `
            <div style="display: flex; align-items: center; gap: 6px; color: #38bdf8;">
              <span>🔵</span> <strong>Binary Page Addition (Version Mutation):</strong> Document is at Content Version ${doc.current_application_version}.
            </div>
            <div style="color: var(--text-dim); margin-top: 2px;">
              LLM enrichment only triggers on initial document creation (Version 1, Revision 1). Content mutations preserve authoritative annotations and do not re-run enrichment.
            </div>
          `;
        }
      } else if (isManualPatch) {
        if (aiGrid) aiGrid.style.display = 'none';
        if (aiCats) aiCats.style.display = 'none';
        if (aiMsg) aiMsg.style.display = 'none';
        if (aiStatusBadge) {
          aiStatusBadge.className = 'badge badge-info';
          aiStatusBadge.innerText = `Manual Rev ${doc.current_metadata_revision}`;
        }
        if (aiLatencyBadge) aiLatencyBadge.style.display = 'none';

        if (step1) { step1.className = 'badge badge-success'; step1.innerText = '✓ 1. Ingestion'; }
        if (step2) { step2.className = 'badge badge-secondary'; step2.innerText = '⊘ 2. SQS Skipped'; }
        if (step3) { step3.className = 'badge badge-secondary'; step3.innerText = '⊘ 3. Bedrock Skipped'; }
        if (step4) { step4.className = 'badge badge-info'; step4.innerText = `✓ 4. Rev ${doc.current_metadata_revision} Manual Edit`; }

        if (aiDiagnosis) {
          aiDiagnosis.innerHTML = `
            <div style="display: flex; align-items: center; gap: 6px; color: #38bdf8;">
              <span>🔵</span> <strong>Manual Metadata Modification:</strong> Document was updated via <code>PATCH /documents/{id}/metadata</code>.
            </div>
            <div style="color: var(--text-dim); margin-top: 2px;">
              Direct user updates via DynamoDB OCC are authoritative. The automated LLM pipeline never overwrites user edits.
            </div>
          `;
        }
      } else if (isPending) {
        if (aiGrid) aiGrid.style.display = 'none';
        if (aiCats) aiCats.style.display = 'none';
        if (aiMsg) aiMsg.style.display = 'none';
        if (aiStatusBadge) {
          aiStatusBadge.className = 'badge badge-warning';
          aiStatusBadge.innerText = 'Queued in SQS';
        }
        if (aiLatencyBadge) aiLatencyBadge.style.display = 'none';

        if (step1) { step1.className = 'badge badge-success'; step1.innerText = '✓ 1. Ingestion (v1)'; }
        if (step2) { step2.className = 'badge badge-warning'; step2.innerText = '⏳ 2. In SQS Queue'; }
        if (step3) { step3.className = 'badge badge-info'; step3.innerText = '3. Bedrock Scanning'; }
        if (step4) { step4.className = 'badge badge-secondary'; step4.innerText = '4. Rev 2 Pending'; }

        if (aiDiagnosis) {
          aiDiagnosis.innerHTML = `
            <div style="display: flex; align-items: center; gap: 6px; color: #fbbf24;">
              <span>⏳</span> <strong>Asynchronous Enrichment Queued:</strong> Document is queued in SQS (<code>doc-platform-mvp-enrichment-queue</code>).
            </div>
            <div style="color: var(--text-dim); margin-top: 2px;">
              Bedrock Claude 3 Haiku will enrich PII and generate metadata revision 2 in ~1.5s.
              <a href="javascript:void(0)" onclick="fetchDocumentDetails()" style="color: var(--aws-orange); text-decoration: underline; font-weight: 600;">Click here to refresh</a> in 2-3 seconds.
            </div>
          `;
        }
      } else {
        if (aiGrid) aiGrid.style.display = 'none';
        if (aiCats) aiCats.style.display = 'none';
        if (aiMsg) aiMsg.style.display = 'none';
        if (aiStatusBadge) {
          aiStatusBadge.className = 'badge badge-secondary';
          aiStatusBadge.innerText = 'Standard Metadata';
        }
        if (aiLatencyBadge) aiLatencyBadge.style.display = 'none';
        if (aiDiagnosis) {
          aiDiagnosis.innerHTML = `
            <div style="color: var(--text-dim);">Standard document metadata. AI auto-enrichment was not invoked for this document state.</div>
          `;
        }
      }
    }

    if (auditTabAiCard && auditTabAiContent) {
      if (isEnriched && audit) {
        auditTabAiCard.style.display = 'block';
        auditTabAiContent.innerText = JSON.stringify({
          document_id: doc.document_id,
          document_class: doc.document_class,
          current_metadata_revision: doc.current_metadata_revision,
          metadata_updated_by: doc.metadata?.metadata_updated_by,
          contains_pii: doc.metadata?.contains_pii,
          pii_categories: doc.metadata?.pii_categories,
          enrichment_audit: audit,
          s3_audit_log_path: `s3://doc-platform-mvp-audit-216662987392/audit/llm-enrichment/${new Date(audit.applied_at || Date.now()).toISOString().slice(0,10)}/${doc.document_id}/enrichment-audit.json`
        }, null, 2);
      } else {
        auditTabAiCard.style.display = 'none';
      }
    }

    // Sync doc ID to other tabs
    const metaEditId = document.getElementById('meta-edit-doc-id');
    if (metaEditId) metaEditId.value = doc.document_id;
    const expectedRevInput = document.getElementById('meta-edit-expected-rev');
    if (expectedRevInput) expectedRevInput.value = doc.current_metadata_revision;

    const delId = document.getElementById('admin-delete-doc-id');
    if (delId) delId.value = doc.document_id;
    const resId = document.getElementById('admin-restore-doc-id');
    if (resId) resId.value = doc.document_id;

    const auditDocInput = document.getElementById('audit-doc-id');
    if (auditDocInput) auditDocInput.value = doc.document_id;
    fetchDocumentAudit(doc.document_id);

    // Load Preview
    const previewIframe = document.getElementById('doc-preview-iframe');
    const downloadBtn = document.getElementById('btn-download-file');
    const downloadPdfBtn = document.getElementById('btn-download-pdf');
    if (doc.download_url) {
      previewIframe.src = doc.download_url;
      downloadBtn.href = doc.download_url;
    }

    if (downloadPdfBtn) {
      if (isConvertibleImage(doc)) {
        downloadPdfBtn.style.display = 'inline-flex';
      } else {
        downloadPdfBtn.style.display = 'none';
      }
    }

    fetchVersionHistory(targetId);
    showToast('Document details loaded', 'success');
  } catch (err) {
    showToast(`Fetch document failed: ${err.message}`, 'danger');
  }
}

async function openDocumentDirect(docId, versionNum = null, format = null) {
  const queryParams = new URLSearchParams({ direct: 'true' });
  if (versionNum) queryParams.set('version', String(versionNum));
  if (format) queryParams.set('format', format);

  const url = `${state.config.apiUrl.replace(/\/$/, '')}/documents/${docId}/download?${queryParams.toString()}`;
  const headers = {};
  if (state.auth.token) headers['Authorization'] = `Bearer ${state.auth.token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      errMsg = errJson.error?.message || errJson.message || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const json = await res.json();
    if (json.download_url) {
      window.open(json.download_url, '_blank');
      return;
    }
  }

  const blob = await res.blob();
  const blobUrl = window.URL.createObjectURL(blob);
  window.open(blobUrl, '_blank');
  setTimeout(() => window.URL.revokeObjectURL(blobUrl), 30000);
}

async function downloadActiveDocPdf() {
  const targetId = document.getElementById('viewer-doc-id')?.value?.trim() || state.activeDocument?.document_id;
  if (!targetId) {
    showToast('Please fetch or select a document first', 'warning');
    return;
  }
  try {
    showToast('Preparing PDF derivative on AWS Graviton...', 'info');
    await openDocumentDirect(targetId, null, 'pdf');
    showToast('PDF opened in new tab!', 'success');
  } catch (err) {
    showToast(`PDF download failed: ${err.message}`, 'danger');
  }
}

async function downloadPdfDirect(docId) {
  if (!docId) return;
  try {
    showToast('Generating PDF derivative...', 'info');
    await openDocumentDirect(docId, null, 'pdf');
    showToast('PDF opened in new tab!', 'success');
  } catch (err) {
    showToast(`PDF generation failed: ${err.message}`, 'danger');
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
            <button class="btn btn-primary btn-sm" style="margin-left: 4px;" onclick="downloadSpecificVersionPdf('${targetId}', ${v.application_version})">⬇️ PDF</button>
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
    await openDocumentDirect(docId, versionNum);
  } catch (err) {
    showToast(`Failed to load version ${versionNum}: ${err.message}`, 'danger');
  }
}

async function downloadSpecificVersionPdf(docId, versionNum) {
  try {
    showToast(`Generating PDF for version v${versionNum}...`, 'info');
    await openDocumentDirect(docId, versionNum, 'pdf');
    showToast(`v${versionNum} PDF ready!`, 'success');
  } catch (err) {
    showToast(`Failed to load v${versionNum} PDF: ${err.message}`, 'danger');
  }
}

// ==========================================
// 6.1 ADD PAGES TO PDF
// ==========================================
let selectedAddPagesFile = null;

function toggleAddPagesSection() {
  const content = document.getElementById('add-pages-content');
  const btn = document.getElementById('btn-toggle-add-pages');
  if (!content) return;
  const isHidden = content.style.display === 'none';
  content.style.display = isHidden ? 'block' : 'none';
  if (btn) btn.innerText = isHidden ? '▲ Hide' : '▼ Show';
}

function handleAddPagesFileSelect(input) {
  if (input.files && input.files[0]) {
    selectedAddPagesFile = input.files[0];
    const info = document.getElementById('add-pages-file-info');
    if (info) {
      info.innerHTML = `<span style="color: var(--color-success);">Selected: <strong>${selectedAddPagesFile.name}</strong> (${(selectedAddPagesFile.size / 1024).toFixed(1)} KB, ${selectedAddPagesFile.type || 'application/pdf'})</span>`;
    }
  }
}

function onAddPagesPositionChange(value) {
  const customGroup = document.getElementById('add-pages-custom-index-group');
  if (customGroup) {
    customGroup.style.display = value === 'custom' ? 'block' : 'none';
  }
}

async function executeAddPages() {
  const docId = state.activeDocument?.document_id || document.getElementById('viewer-doc-id')?.value?.trim();
  if (!docId) {
    showToast('Please fetch a document first', 'warning');
    return;
  }

  if (!selectedAddPagesFile) {
    showToast('Please select a PDF or image file to add', 'warning');
    return;
  }

  const posType = document.getElementById('add-pages-position-type')?.value || 'end';
  let position = posType;
  if (posType === 'custom') {
    const customIdx = parseInt(document.getElementById('add-pages-custom-index')?.value, 10);
    position = isNaN(customIdx) || customIdx < 0 ? 0 : customIdx;
  }

  const indicesRaw = document.getElementById('add-pages-page-indices')?.value?.trim() || '';
  let pageIndices = undefined;
  if (indicesRaw) {
    pageIndices = indicesRaw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n >= 0);
  }

  const btn = document.getElementById('btn-execute-add-pages');
  const statusEl = document.getElementById('add-pages-status');

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerText = '⏳ Processing & Merging Pages...';
    }
    if (statusEl) {
      statusEl.style.color = '#38bdf8';
      statusEl.innerText = 'Reading binary content and preparing mutation...';
    }

    const fileBytes = await selectedAddPagesFile.arrayBuffer();
    const base64Bytes = btoa(
      new Uint8Array(fileBytes).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    const payload = {
      pages_base64: base64Bytes,
      content_type: selectedAddPagesFile.type || 'application/pdf',
      position,
    };
    if (pageIndices && pageIndices.length > 0) {
      payload.page_indices = pageIndices;
    }

    if (statusEl) statusEl.innerText = 'Sending POST /documents/{id}/pages to API Gateway...';

    const res = await apiCall('POST', `/documents/${docId}/pages`, payload);

    if (statusEl) {
      statusEl.style.color = 'var(--color-success)';
      statusEl.innerText = `Success! New version v${res.application_version} created (Total pages: ${res.page_count}).`;
    }
    showToast(`Pages added successfully! New Version: v${res.application_version}`, 'success');

    // Reset file selection
    selectedAddPagesFile = null;
    const fileInput = document.getElementById('add-pages-file-input');
    if (fileInput) fileInput.value = '';
    const info = document.getElementById('add-pages-file-info');
    if (info) info.innerText = '';

    // Immediately reload document in viewer to show new pages and new version
    await fetchDocumentDetails(docId);
  } catch (err) {
    if (statusEl) {
      statusEl.style.color = '#f87171';
      statusEl.innerText = `Error: ${err.message}`;
    }
    showToast(`Failed to add pages: ${err.message}`, 'danger');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '➕ Add Pages & Create New Version';
    }
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
    changes = parseJsonRelaxed(document.getElementById('meta-edit-changes').value);
  } catch (e) {
    showToast(`Invalid JSON in metadata changes: ${e.message}`, 'danger');
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
          const formatBadge = doc.format
            ? `<span class="badge badge-secondary" style="font-size:0.75rem; text-transform: uppercase; margin-left: 4px;">${doc.format}${doc.page_count ? ` (${doc.page_count}p)` : ''}</span>`
            : '';
          const dateStr = doc.created_at ? new Date(doc.created_at).toLocaleDateString() : 'N/A';
          const statusBadge = doc.status === 'ACTIVE' ? 'badge-success' : 'badge-danger';
          const showPdf = isConvertibleImage(doc);
          const isSelected = selectedSearchDocIds.has(doc.document_id);
          const pdfButtonHtml = showPdf
            ? `<button class="btn btn-primary btn-sm" style="margin-left: 4px;" onclick="downloadPdfDirect('${doc.document_id}')">⬇️ PDF</button>`
            : '';
          return `
            <tr>
              <td style="text-align: center;">
                <input type="checkbox" class="search-doc-checkbox" data-doc-id="${doc.document_id}" onchange="toggleDocSelection('${doc.document_id}', this.checked)" ${isSelected ? 'checked' : ''} />
              </td>
              <td><code style="color: #38bdf8; font-size: 0.8rem;">${doc.document_id}</code></td>
              <td><span class="badge badge-info">${doc.document_class || 'loan_agreement'}</span></td>
              <td><span style="font-size: 0.82rem; color: #f8fafc;">${descriptor}</span>${formatBadge}</td>
              <td><span class="badge ${statusBadge}">${doc.status || 'ACTIVE'}</span></td>
              <td>v${doc.application_version || 1}</td>
              <td style="font-size: 0.8rem; color: var(--text-dim);">${dateStr}</td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="loadSearchedDoc('${doc.document_id}')">📂 Inspect</button>
                ${pdfButtonHtml}
              </td>
            </tr>
          `;
        })
        .join('');
      updateSearchBatchToolbar();
    } else {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 1.5rem;">No documents matched the specified filters. Try selecting "All Document Classes" or clicking "Reset & View All".</td></tr>`;
      updateSearchBatchToolbar();
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

  // Storage (Primary WORM + 14-day cached PDF derivatives)
  const primaryStorageGb = (docsCumulative * avgSizeMb) / 1024;
  const derivativeStorageGb = (queriesMonthly * 0.25 * 0.35 * (14 / 30)) / 1024; // 25% PDF requests @ 350KB with 14d TTL
  const totalStorageGb = primaryStorageGb + derivativeStorageGb;
  const s3StorageCost = totalStorageGb * PRICING_IL.s3_storage_gb_mo;
  const s3PutCost = ((docsMonthly * 2 + queriesMonthly * 0.25 * 0.2) * PRICING_IL.s3_put_1k) / 1000;
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

  // Lambda (ARM64 Graviton)
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
        <td>${primaryStorageGb.toFixed(1)} GB primary + ${derivativeStorageGb.toFixed(1)} GB cached derivatives + Annotations</td>
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

// ============================================================================
// BATCH ZIP DOWNLOAD & MULTI-DOC EXPORT
// ============================================================================
const selectedSearchDocIds = new Set();

function updateSearchBatchToolbar() {
  const toolbar = document.getElementById('search-batch-toolbar');
  const countBadge = document.getElementById('search-selected-count');
  const selectAllBox = document.getElementById('search-select-all');

  if (toolbar && countBadge) {
    if (selectedSearchDocIds.size > 0) {
      toolbar.style.display = 'flex';
      countBadge.innerText = `${selectedSearchDocIds.size} selected`;
    } else {
      toolbar.style.display = 'none';
    }
  }

  if (selectAllBox) {
    const pageCheckboxes = document.querySelectorAll('.search-doc-checkbox');
    if (pageCheckboxes.length > 0) {
      const allChecked = Array.from(pageCheckboxes).every((cb) => cb.checked);
      const someChecked = Array.from(pageCheckboxes).some((cb) => cb.checked);
      selectAllBox.checked = allChecked;
      selectAllBox.indeterminate = !allChecked && someChecked;
    } else {
      selectAllBox.checked = false;
      selectAllBox.indeterminate = false;
    }
  }
}

function toggleDocSelection(docId, isChecked) {
  if (isChecked) {
    selectedSearchDocIds.add(docId);
  } else {
    selectedSearchDocIds.delete(docId);
  }
  updateSearchBatchToolbar();
}

function toggleSelectAllSearchResults(isChecked) {
  const pageCheckboxes = document.querySelectorAll('.search-doc-checkbox');
  pageCheckboxes.forEach((cb) => {
    cb.checked = isChecked;
    const id = cb.getAttribute('data-doc-id');
    if (id) {
      if (isChecked) selectedSearchDocIds.add(id);
      else selectedSearchDocIds.delete(id);
    }
  });
  updateSearchBatchToolbar();
}

function clearSelectedSearchDocs() {
  selectedSearchDocIds.clear();
  const pageCheckboxes = document.querySelectorAll('.search-doc-checkbox');
  pageCheckboxes.forEach((cb) => (cb.checked = false));
  updateSearchBatchToolbar();
}


async function triggerBatchZipDownload(payload) {
  const url = `${state.config.apiUrl.replace(/\/$/, '')}/documents/batch-download?direct=true`;
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/zip, application/json',
  };
  if (state.auth.token) {
    headers['Authorization'] = `Bearer ${state.auth.token}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, direct: true }),
  });

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      errMsg = errJson.error?.message || errJson.message || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/zip') || contentType.includes('application/octet-stream')) {
    // 1. Direct in-band binary delivery (bypasses S3 and corporate S3 VPC Endpoint)
    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const contentDisposition = res.headers.get('content-disposition') || '';
    const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    const filename = filenameMatch ? filenameMatch[1] : `documents_export_${Date.now()}.zip`;

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 20000);
    showToast(`ZIP downloaded directly (${(blob.size / 1024).toFixed(1)} KB)!`, 'success');
    return { direct: true, filename, size: blob.size };
  } else {
    // 2. Fallback to S3 presigned URL if payload > 5 MB
    const json = await res.json();
    if (json.download_url) {
      showToast(`ZIP created (${json.file_count} files). Starting download...`, 'info');
      const a = document.createElement('a');
      a.href = json.download_url;
      a.download = json.zip_filename || 'documents_export.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return { direct: false, filename: json.zip_filename, url: json.download_url };
    }
    return json;
  }
}

async function downloadSelectedSearchDocsZip(format = 'original') {
  if (selectedSearchDocIds.size === 0) {
    showToast('Please select at least one document first', 'warning');
    return;
  }

  const docIds = Array.from(selectedSearchDocIds);
  const includeMeta = document.getElementById('search-batch-include-meta')?.checked ?? true;

  showToast(`Packaging ${docIds.length} documents into ZIP (${format})...`, 'info');

  try {
    await triggerBatchZipDownload({
      document_ids: docIds,
      format,
      include_metadata: includeMeta,
      direct: true,
    });
  } catch (err) {
    showToast(`Batch ZIP export failed: ${err.message}`, 'danger');
  }
}

function toggleBatchViewerSection() {
  const content = document.getElementById('batch-viewer-content');
  const btn = document.getElementById('btn-toggle-batch-viewer');
  if (!content) return;
  const isHidden = content.style.display === 'none';
  content.style.display = isHidden ? 'block' : 'none';
  if (btn) btn.innerText = isHidden ? '▲ Hide' : '▼ Show';
}

async function executeBatchFetchZip() {
  const idsInput = document.getElementById('batch-viewer-doc-ids')?.value || '';
  const format = document.getElementById('batch-viewer-format')?.value || 'original';
  const includeMeta = document.getElementById('batch-viewer-meta')?.checked ?? true;
  const statusSpan = document.getElementById('batch-viewer-status');
  const btn = document.getElementById('btn-batch-fetch-zip');

  const docIds = idsInput
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (docIds.length === 0) {
    showToast('Please enter at least one Document ID (UUID)', 'warning');
    return;
  }

  if (btn) btn.disabled = true;
  if (statusSpan) statusSpan.innerText = `Packaging ${docIds.length} documents into ZIP...`;

  try {
    const result = await triggerBatchZipDownload({
      document_ids: docIds,
      format,
      include_metadata: includeMeta,
      direct: true,
    });
    if (statusSpan) {
      statusSpan.innerText = `✅ ZIP Ready (${result.filename || 'documents_export.zip'})`;
    }
  } catch (err) {
    if (statusSpan) statusSpan.innerText = `❌ Failed: ${err.message}`;
    showToast(`Batch download failed: ${err.message}`, 'danger');
  } finally {
    if (btn) btn.disabled = false;
  }
}
 
// ==========================================
// 10. AI CONVERSATIONAL DOCUMENT ASSISTANT (Bedrock AgentCore + Claude Sonnet 5)
// ==========================================

function generateUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function initAiAssistant() {
  if (!state.ai.sessionId) {
    state.ai.sessionId = generateUuid();
  }
  if (!state.ai.streamingUrl && state.config.agentStreamingUrl) {
    state.ai.streamingUrl = state.config.agentStreamingUrl;
  }
  updateAiSessionDisplay();
  const endpointInput = document.getElementById('ai-custom-endpoint');
  if (endpointInput) {
    endpointInput.value = state.ai.streamingUrl || '';
  }
}

function updateAiSessionDisplay() {
  const el = document.getElementById('ai-current-session-id');
  if (el) {
    const shortId = state.ai.sessionId.length > 8 ? state.ai.sessionId.substring(0, 8) + '...' : state.ai.sessionId;
    el.innerText = shortId;
    el.parentElement?.setAttribute('title', `Active Ephemeral Session ID: ${state.ai.sessionId}`);
  }
}

function startNewAiSession() {
  state.ai.sessionId = generateUuid();
  updateAiSessionDisplay();
  clearAiChat();
  showToast(`New AI Assistant session started (${state.ai.sessionId.substring(0, 8)})`, 'info');
}

function clearAiChat() {
  const container = document.getElementById('ai-chat-messages');
  if (!container) return;
  container.innerHTML = `
    <div class="ai-message ai-message-assistant" id="ai-welcome-msg">
      <div class="ai-avatar ai-avatar-assistant">🤖</div>
      <div class="ai-bubble">
        <p><strong>Hello! I am your AI Document Assistant</strong>, powered by Amazon Bedrock AgentCore and intelligent MCP tools.</p>
        <p>I have direct real-time access to your repository via MCP Gateway tools:</p>
        <ul>
          <li>🔍 <code>search_documents</code>: Multi-attribute search across customers, loan numbers, document classes, and metadata.</li>
          <li>📄 <code>fetch_document</code>: Retrieval of authoritative S3 document annotations, versions, and verified content.</li>
        </ul>
        <p style="color: var(--text-dim); font-size: 0.85rem; margin-top: 0.5rem;">
          Ask questions in plain English or select a suggestion above. Responses include real-time SSE streaming, live tool badges, and interactive citations you can open in the Document Viewer.
        </p>
      </div>
    </div>
  `;
  setAiStatus('Idle');
}

function toggleAiSettings() {
  const el = document.getElementById('ai-endpoint-config');
  if (!el) return;
  el.style.display = el.style.display === 'none' || !el.style.display ? 'block' : 'none';
}

function saveAiEndpointConfig() {
  const input = document.getElementById('ai-custom-endpoint');
  const val = input ? input.value.trim() : '';
  state.ai.streamingUrl = val;
  if (val) {
    localStorage.setItem('doc_platform_agent_streaming_url', val);
    showToast('Agent streaming endpoint saved', 'success');
  } else {
    localStorage.removeItem('doc_platform_agent_streaming_url');
    showToast('Agent endpoint reset to default (/v1/agent/chat)', 'info');
  }
  toggleAiSettings();
}

function resetAiEndpointConfig() {
  state.ai.streamingUrl = state.config.agentStreamingUrl || '';
  localStorage.removeItem('doc_platform_agent_streaming_url');
  const input = document.getElementById('ai-custom-endpoint');
  if (input) input.value = state.ai.streamingUrl;
  showToast('Reset to configuration default', 'info');
}

function handlePromptChipClick(promptText) {
  const input = document.getElementById('ai-user-input');
  if (input) {
    input.value = promptText;
    autoResizeAiTextarea(input);
  }
  submitAiMessage();
}

function handleAiInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitAiMessage();
  }
}

function autoResizeAiTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function setAiStatus(status, color = '#a5b4fc') {
  const el = document.getElementById('ai-stream-status');
  if (el) {
    el.innerText = status;
    el.style.color = color;
  }
}

function setAiStreamingMode(isStreaming) {
  state.ai.isStreaming = isStreaming;
  const sendBtn = document.getElementById('btn-ai-send');
  const stopBtn = document.getElementById('btn-ai-stop');
  const input = document.getElementById('ai-user-input');

  if (sendBtn) sendBtn.style.display = isStreaming ? 'none' : 'inline-flex';
  if (stopBtn) stopBtn.style.display = isStreaming ? 'inline-flex' : 'none';
  if (input) input.disabled = isStreaming;
}

function stopAiStreaming() {
  if (state.ai.abortController) {
    state.ai.abortController.abort();
    state.ai.abortController = null;
  }
  setAiStreamingMode(false);
  setAiStatus('Stopped', '#f87171');
  showToast('AI response generation stopped', 'warning');
}

function scrollAiChatToBottom() {
  const container = document.getElementById('ai-chat-messages');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

function openCitationInViewer(docId) {
  if (!docId) return;
  const cleanId = docId.replace(/^DOC#/i, '').trim();
  const viewerInput = document.getElementById('viewer-doc-id');
  if (viewerInput) {
    viewerInput.value = cleanId;
  }
  const tabBtn = document.querySelector('.tab-btn[data-tab="tab-viewer"]');
  if (tabBtn) {
    tabBtn.click();
  }
  fetchDocumentDetails(cleanId);
  showToast(`Loaded DOC#${cleanId.substring(0, 8)}... into Document Viewer`, 'info');
}

function copyCitationDocId(docId) {
  const cleanId = docId.replace(/^DOC#/i, '').trim();
  navigator.clipboard.writeText(cleanId).then(
    () => showToast(`Copied document ID: ${cleanId}`, 'success'),
    () => showToast('Failed to copy to clipboard', 'danger')
  );
}

function formatAiMarkdown(rawText) {
  if (!rawText) return '';
  let html = rawText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^(\s*)[-*•]\s+(.+)$/gm, '<li>$2</li>')
    .replace(/^(\s*)\d+\.\s+(.+)$/gm, '<li>$2</li>')
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  html = html.replace(/(<li>[\s\S]*?<\/li>)+/g, '<ul>$&</ul>');
  html = `<p>${html}</p>`;

  const uuidPattern = /\b(?:DOC#)?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b/g;
  html = html.replace(uuidPattern, (_m, uuid) => {
    return `<span class="doc-link" onclick="openCitationInViewer('${uuid}')" title="Inspect DOC#${uuid} in Document Viewer">DOC#${uuid.substring(0, 8)}...</span>`;
  });

  return html;
}

function appendAiUserMessage(text) {
  const container = document.getElementById('ai-chat-messages');
  if (!container) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'ai-message ai-message-user';
  msgDiv.innerHTML = `
    <div class="ai-avatar ai-avatar-user">👤</div>
    <div class="ai-bubble">
      <p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>
    </div>
  `;
  container.appendChild(msgDiv);
  scrollAiChatToBottom();
}

function appendAiAssistantMessageContainer() {
  const container = document.getElementById('ai-chat-messages');
  if (!container) return null;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'ai-message ai-message-assistant';
  msgDiv.innerHTML = `
    <div class="ai-avatar ai-avatar-assistant">🤖</div>
    <div class="ai-bubble">
      <div class="tool-calls-container"></div>
      <div class="ai-text-content"></div>
      <div class="citations-box" style="display: none;">
        <div class="citations-title">
          <span>📚</span> <span>Authoritative Document Citations</span>
        </div>
        <div class="citations-grid"></div>
      </div>
    </div>
  `;
  container.appendChild(msgDiv);
  scrollAiChatToBottom();
  return msgDiv.querySelector('.ai-bubble');
}

function addToolBadge(container, toolName, input) {
  const badgeId = `tool-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const badge = document.createElement('div');
  badge.className = 'tool-badge';
  badge.id = badgeId;

  const toolIcon = toolName === 'search_documents' ? '🔍' : toolName === 'fetch_document' ? '📄' : '🛠️';
  let summary = '';
  if (input) {
    if (input.customer_id) summary += ` customer:${input.customer_id}`;
    if (input.loan_number) summary += ` loan:${input.loan_number}`;
    if (input.document_id) summary += ` doc:${input.document_id.substring(0, 8)}...`;
    if (input.query) summary += ` query:"${input.query}"`;
    if (input.document_class) summary += ` class:${input.document_class}`;
  }

  badge.innerHTML = `
    <div class="tool-badge-header" onclick="const det = this.nextElementSibling; det.style.display = det.style.display === 'none' ? 'block' : 'none';">
      <div class="tool-badge-left">
        <span>${toolIcon}</span>
        <span class="tool-badge-name">${toolName}</span>
        <span style="font-size: 0.72rem; color: #94a3b8;">${summary}</span>
      </div>
      <div class="tool-badge-status running">
        <span class="spin-icon">⏳</span> <span>Executing...</span>
      </div>
    </div>
    <div class="tool-badge-details" style="display: none;">
      <strong>Input:</strong> ${JSON.stringify(input || {}, null, 2)}
    </div>
  `;
  container.appendChild(badge);
  scrollAiChatToBottom();
  return badgeId;
}

function updateToolBadge(container, toolName, output) {
  const badges = container.querySelectorAll('.tool-badge');
  if (badges.length === 0) return;
  const latestBadge = badges[badges.length - 1];
  const statusEl = latestBadge.querySelector('.tool-badge-status');
  const detailsEl = latestBadge.querySelector('.tool-badge-details');

  const isError = output && output.error;
  if (statusEl) {
    statusEl.className = `tool-badge-status ${isError ? 'error' : 'success'}`;
    statusEl.innerHTML = isError ? '❌ Error' : '✅ Complete';
  }
  if (detailsEl) {
    const existing = detailsEl.innerHTML;
    detailsEl.innerHTML = `${existing}\n\n<strong>Result:</strong> ${JSON.stringify(output || {}, null, 2)}`;
  }
}

function renderCitationCard(container, cit) {
  const card = document.createElement('div');
  card.className = 'citation-card';
  card.onclick = () => openCitationInViewer(cit.document_id);
  card.title = `Click to inspect DOC#${cit.document_id} in Document Viewer`;

  const classBadgeColor =
    cit.document_class === 'loan_agreement'
      ? '#38bdf8'
      : cit.document_class === 'compliance_retention'
      ? '#34d399'
      : '#fbbf24';

  card.innerHTML = `
    <div class="citation-card-header">
      <span class="citation-filename">📄 ${cit.filename || 'Document'}</span>
      <span class="badge" style="background: rgba(255,255,255,0.08); font-size: 0.68rem; color: #f8fafc;">v${cit.application_version || 1}</span>
    </div>
    <div class="citation-meta-row">
      <span style="color: ${classBadgeColor}; font-weight: 600;">${cit.document_class || 'document'}</span>
      <span class="citation-doc-id">DOC#${(cit.document_id || '').substring(0, 12)}...</span>
    </div>
  `;
  container.appendChild(card);
}

async function streamFromFunctionUrl(url, prompt, signal, callbacks) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (state.auth.token) {
    headers['Authorization'] = `Bearer ${state.auth.token}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: prompt,
      sessionId: state.ai.sessionId,
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    let msg = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(errText);
      msg = parsed.message || parsed.error?.message || msg;
    } catch (_) {
      if (errText) msg = errText;
    }
    throw new Error(msg);
  }

  if (!response.body) {
    throw new Error('ReadableStream not supported by server response');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    let currentEvent = 'message';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        currentEvent = 'message';
        continue;
      }
      if (trimmed.startsWith('event:')) {
        currentEvent = trimmed.slice(6).trim();
      } else if (trimmed.startsWith('data:')) {
        const rawData = trimmed.slice(5).trim();
        try {
          const data = JSON.parse(rawData);
          switch (currentEvent) {
            case 'progress':
              callbacks.onProgress?.(data);
              break;
            case 'tool_call':
              callbacks.onToolCall?.(data);
              break;
            case 'tool_result':
              callbacks.onToolResult?.(data);
              break;
            case 'text_delta':
              callbacks.onTextDelta?.(data);
              break;
            case 'done':
              callbacks.onDone?.(data);
              break;
            case 'error':
              throw new Error(data.message || data.code || 'Streaming error');
          }
        } catch (jsonErr) {
          if (jsonErr.message && !jsonErr.message.includes('JSON')) {
            throw jsonErr;
          }
        }
      }
    }
  }
}

async function simulateStreamingTyping(targetEl, fullText, cursorEl) {
  cursorEl?.remove();
  const words = fullText.split(/(\s+)/);
  let current = '';
  for (let i = 0; i < words.length; i++) {
    current += words[i];
    targetEl.innerHTML = formatAiMarkdown(current);
    if (cursorEl) targetEl.appendChild(cursorEl);
    scrollAiChatToBottom();
    if (i % 2 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }
  cursorEl?.remove();
  targetEl.innerHTML = formatAiMarkdown(fullText);
}

async function submitAiMessage() {
  const input = document.getElementById('ai-user-input');
  if (!input) return;
  const prompt = input.value.trim();
  if (!prompt) return;

  if (!state.auth.token) {
    showToast('Please sign in first to interact with the AI Document Assistant', 'warning');
    showLoginView();
    return;
  }

  if (state.ai.isStreaming) return;

  input.value = '';
  autoResizeAiTextarea(input);

  appendAiUserMessage(prompt);

  const assistantBubble = appendAiAssistantMessageContainer();
  if (!assistantBubble) return;

  const textContentDiv = assistantBubble.querySelector('.ai-text-content');
  const toolContainerDiv = assistantBubble.querySelector('.tool-calls-container');
  const citationsBoxDiv = assistantBubble.querySelector('.citations-box');
  const citationsGridDiv = assistantBubble.querySelector('.citations-grid');

  setAiStreamingMode(true);
  setAiStatus('Connecting to AgentCore...', '#a78bfa');

  const cursorSpan = document.createElement('span');
  cursorSpan.className = 'streaming-cursor';
  textContentDiv.appendChild(cursorSpan);

  const abortController = new AbortController();
  state.ai.abortController = abortController;

  const streamingUrl = state.ai.streamingUrl || state.config.agentStreamingUrl;
  const isFunctionUrl = !!(streamingUrl && streamingUrl.includes('lambda-url'));

  let accumulatedText = '';
  const citationsReceived = [];

  try {
    if (isFunctionUrl) {
      setAiStatus('Streaming from Amazon Bedrock...', '#38bdf8');
      await streamFromFunctionUrl(streamingUrl, prompt, abortController.signal, {
        onProgress: (data) => {
          setAiStatus(data.status || 'Processing...', '#38bdf8');
        },
        onToolCall: (data) => {
          addToolBadge(toolContainerDiv, data.tool, data.input);
          setAiStatus(`Invoking ${data.tool}...`, '#c084fc');
        },
        onToolResult: (data) => {
          updateToolBadge(toolContainerDiv, data.tool, data.output);
        },
        onTextDelta: (data) => {
          accumulatedText += data.delta || '';
          cursorSpan.remove();
          textContentDiv.innerHTML = formatAiMarkdown(accumulatedText);
          textContentDiv.appendChild(cursorSpan);
          scrollAiChatToBottom();
        },
        onDone: (data) => {
          if (data.citations && Array.isArray(data.citations)) {
            citationsReceived.push(...data.citations);
          }
        },
      });
      cursorSpan.remove();
      textContentDiv.innerHTML = formatAiMarkdown(accumulatedText);
    } else {
      setAiStatus('Reasoning with Amazon Bedrock & MCP Tools...', '#38bdf8');
      const res = await apiCall('POST', '/agent/chat', {
        message: prompt,
        sessionId: state.ai.sessionId,
      });

      if (res.tools_used && Array.isArray(res.tools_used)) {
        res.tools_used.forEach((tool) => {
          addToolBadge(toolContainerDiv, tool, { status: 'Executed via AgentCore Harness' });
          updateToolBadge(toolContainerDiv, tool, { status: 'Complete' });
        });
      }

      accumulatedText = res.message || '';
      await simulateStreamingTyping(textContentDiv, accumulatedText, cursorSpan);

      if (res.citations && Array.isArray(res.citations)) {
        citationsReceived.push(...res.citations);
      }
    }

    cursorSpan.remove();
    if (citationsReceived.length > 0) {
      citationsBoxDiv.style.display = 'block';
      citationsGridDiv.innerHTML = '';
      citationsReceived.forEach((cit) => {
        renderCitationCard(citationsGridDiv, cit);
      });
    }

    setAiStatus('Ready', '#34d399');
  } catch (err) {
    cursorSpan.remove();
    if (err.name === 'AbortError') {
      textContentDiv.innerHTML += '<p style="color: #f87171; font-style: italic;">[Generation cancelled by user]</p>';
      setAiStatus('Stopped', '#f87171');
    } else {
      console.error('AI assistant error:', err);
      if (isFunctionUrl && state.config.apiUrl) {
        showToast(`Function URL stream unavailable. Retrying via API Gateway...`, 'warning');
        try {
          setAiStatus('Retrying via API Gateway...', '#fbbf24');
          const res = await apiCall('POST', '/agent/chat', {
            message: prompt,
            sessionId: state.ai.sessionId,
          });
          if (res.tools_used && Array.isArray(res.tools_used)) {
            res.tools_used.forEach((tool) => {
              addToolBadge(toolContainerDiv, tool, { fallback: true });
              updateToolBadge(toolContainerDiv, tool, { status: 'Complete' });
            });
          }
          accumulatedText = res.message || '';
          await simulateStreamingTyping(textContentDiv, accumulatedText, cursorSpan);
          if (res.citations && Array.isArray(res.citations)) {
            citationsBoxDiv.style.display = 'block';
            citationsGridDiv.innerHTML = '';
            res.citations.forEach((cit) => renderCitationCard(citationsGridDiv, cit));
          }
          setAiStatus('Ready', '#34d399');
          return;
        } catch (fallbackErr) {
          if (fallbackErr.status === 401 || fallbackErr.message?.includes('expired') || fallbackErr.message?.includes('Unauthorized')) {
            textContentDiv.innerHTML += `
              <div class="alert alert-warning" style="margin-top: 8px; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                <div><strong>Session Expired:</strong> Your authentication token has expired. Please sign in to resume.</div>
                <button class="btn btn-primary btn-sm" onclick="showLoginView()" style="white-space: nowrap;">🔑 Sign In</button>
              </div>`;
            setAiStatus('Session Expired', '#f87171');
          } else {
            textContentDiv.innerHTML += `<div class="alert alert-danger" style="margin-top: 8px;"><strong>Error:</strong> ${fallbackErr.message}</div>`;
            setAiStatus('Error', '#f87171');
          }
        }
      } else {
        if (err.status === 401 || err.message?.includes('expired') || err.message?.includes('Unauthorized')) {
          textContentDiv.innerHTML += `
            <div class="alert alert-warning" style="margin-top: 8px; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
              <div><strong>Session Expired:</strong> Your authentication token has expired. Please sign in to resume.</div>
              <button class="btn btn-primary btn-sm" onclick="showLoginView()" style="white-space: nowrap;">🔑 Sign In</button>
            </div>`;
          setAiStatus('Session Expired', '#f87171');
        } else {
          textContentDiv.innerHTML += `<div class="alert alert-danger" style="margin-top: 8px;"><strong>Error:</strong> ${err.message}</div>`;
          setAiStatus('Error', '#f87171');
        }
      }
    }
  } finally {
    setAiStreamingMode(false);
    state.ai.abortController = null;
    scrollAiChatToBottom();
  }
}

// Auto-run on DOM ready
document.addEventListener('DOMContentLoaded', initApp);


