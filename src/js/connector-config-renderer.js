/**
 * Connector Configuration Renderer
 *
 * Generic renderer that reads connector schemas and auto-generates configuration forms
 */

import api from './api.js';

/**
 * Renders a configuration form from a connector schema
 * @param {Object} schema - Connector schema from database
 * @param {HTMLElement} container - Container element to render into
 * @param {Object} currentConfig - Current configuration values (for edit mode)
 * @param {Function} onSave - Callback when configuration is saved
 */
export async function renderConfigurationForm(schema, container, currentConfig = {}, onSave) {
  if (!schema || !schema.config_fields) {
    container.innerHTML = '<div class="text-gray-500">No configuration fields defined</div>';
    return;
  }

  // Build form HTML
  let formHTML = '<form id="connectorConfigForm" class="space-y-6">';

  for (const field of schema.config_fields) {
    formHTML += renderField(field, currentConfig[field.field_name]);
  }

  // Add save button
  formHTML += `
    <div class="flex justify-end space-x-3 pt-6 border-t border-gray-200">
      <button type="button" id="cancelConfigBtn" class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
        Cancel
      </button>
      <button type="submit" id="saveConfigBtn" class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">
        Save Configuration
      </button>
    </div>
  `;

  formHTML += '</form>';

  container.innerHTML = formHTML;

  // Attach event handlers
  attachFieldHandlers(schema, currentConfig);

  // Handle form submission
  const form = document.getElementById('connectorConfigForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const config = collectFormData(schema);

    // Validate configuration
    const validation = await validateConfiguration(schema.connector_id, config);

    if (validation.valid) {
      onSave(config);
    } else {
      displayValidationErrors(validation.errors);
    }
  });
}

/**
 * Renders a single field based on its type
 */
function renderField(field, currentValue) {
  const value = currentValue || field.default || '';
  const required = field.required ? 'required' : '';
  const requiredLabel = field.required ? '<span class="text-red-500">*</span>' : '';

  let fieldHTML = `
    <div class="field-container" data-field="${field.field_name}">
      <label class="block text-sm font-medium text-gray-700 mb-2">
        ${field.label} ${requiredLabel}
      </label>
  `;

  if (field.description) {
    fieldHTML += `<p class="text-sm text-gray-500 mb-2">${field.description}</p>`;
  }

  switch (field.type) {
    case 'directory_browser':
      fieldHTML += renderDirectoryBrowser(field, value);
      break;

    case 'oauth':
      fieldHTML += renderOAuth(field, value);
      break;

    case 'text':
    case 'url':
    case 'email':
      fieldHTML += renderTextInput(field, value, required);
      break;

    case 'password':
    case 'api_key':
      fieldHTML += renderPasswordInput(field, value, required);
      break;

    case 'number':
      fieldHTML += renderNumberInput(field, value, required);
      break;

    case 'select':
      fieldHTML += renderSelect(field, value, required);
      break;

    case 'multiselect':
      fieldHTML += renderMultiSelect(field, value);
      break;

    case 'checkbox':
      fieldHTML += renderCheckbox(field, value);
      break;

    case 'file_picker':
      fieldHTML += renderFilePicker(field, value);
      break;

    default:
      fieldHTML += `<div class="text-red-500">Unknown field type: ${field.type}</div>`;
  }

  fieldHTML += '</div>';
  return fieldHTML;
}

/**
 * Render directory browser field
 */
function renderDirectoryBrowser(field, value) {
  return `
    <div class="flex space-x-2">
      <input
        type="text"
        id="${field.field_name}"
        name="${field.field_name}"
        value="${value}"
        placeholder="Select or enter a directory path"
        class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        ${field.required ? 'required' : ''}
      />
      <button
        type="button"
        class="browse-btn px-4 py-2 bg-gray-100 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-200"
        data-field="${field.field_name}"
        data-config='${JSON.stringify(field.browser_config || {})}'
      >
        <svg class="w-5 h-5 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
        </svg>
        Browse
      </button>
    </div>
  `;
}

/**
 * Render OAuth connection field
 */
function renderOAuth(field, value) {
  const isConnected = !!value;

  return `
    <div class="oauth-container">
      <input type="hidden" id="${field.field_name}" name="${field.field_name}" value="${value}" />

      ${isConnected ? `
        <div class="flex items-center space-x-2 p-3 bg-green-50 border border-green-200 rounded-md">
          <svg class="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
          </svg>
          <span class="text-green-700 font-medium">Connected</span>
          <button
            type="button"
            class="disconnect-oauth-btn ml-auto text-sm text-red-600 hover:text-red-700"
            data-field="${field.field_name}"
          >
            Disconnect
          </button>
        </div>
      ` : `
        <button
          type="button"
          class="connect-oauth-btn w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          data-field="${field.field_name}"
          data-provider="${field.oauth_config?.provider || 'generic'}"
        >
          <svg class="w-5 h-5 inline-block mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"></path>
            <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"></path>
          </svg>
          Connect ${field.label}
        </button>
      `}
    </div>
  `;
}

/**
 * Render text input field
 */
function renderTextInput(field, value, required) {
  const inputType = field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : 'text';

  return `
    <input
      type="${inputType}"
      id="${field.field_name}"
      name="${field.field_name}"
      value="${value}"
      placeholder="${field.placeholder || ''}"
      class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      ${required}
    />
  `;
}

/**
 * Render password/API key input field
 */
function renderPasswordInput(field, value, required) {
  return `
    <div class="relative">
      <input
        type="password"
        id="${field.field_name}"
        name="${field.field_name}"
        value="${value}"
        placeholder="${field.placeholder || '••••••••'}"
        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        ${required}
      />
      <button
        type="button"
        class="toggle-password absolute right-2 top-2 text-gray-400 hover:text-gray-600"
        data-field="${field.field_name}"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
        </svg>
      </button>
    </div>
  `;
}

/**
 * Render number input field
 */
function renderNumberInput(field, value, required) {
  const min = field.validation?.min !== undefined ? `min="${field.validation.min}"` : '';
  const max = field.validation?.max !== undefined ? `max="${field.validation.max}"` : '';
  const step = field.validation?.step !== undefined ? `step="${field.validation.step}"` : '';

  return `
    <input
      type="number"
      id="${field.field_name}"
      name="${field.field_name}"
      value="${value}"
      placeholder="${field.placeholder || ''}"
      class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      ${required}
      ${min}
      ${max}
      ${step}
    />
  `;
}

/**
 * Render select dropdown field
 */
function renderSelect(field, value, required) {
  let html = `
    <select
      id="${field.field_name}"
      name="${field.field_name}"
      class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      ${required}
    >
      <option value="">Select ${field.label}</option>
  `;

  for (const option of (field.options || [])) {
    const optionValue = typeof option === 'object' ? option.value : option;
    const optionLabel = typeof option === 'object' ? option.label : option;
    const selected = value === optionValue ? 'selected' : '';

    html += `<option value="${optionValue}" ${selected}>${optionLabel}</option>`;
  }

  html += '</select>';
  return html;
}

/**
 * Render multi-select checkboxes field
 */
function renderMultiSelect(field, value) {
  const selectedValues = Array.isArray(value) ? value : (value ? [value] : []);

  let html = '<div class="space-y-2">';

  for (const option of (field.options || [])) {
    const optionValue = typeof option === 'object' ? option.value : option;
    const optionLabel = typeof option === 'object' ? option.label : option;
    const checked = selectedValues.includes(optionValue) ? 'checked' : '';

    html += `
      <label class="flex items-center space-x-2">
        <input
          type="checkbox"
          name="${field.field_name}[]"
          value="${optionValue}"
          ${checked}
          class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span class="text-sm text-gray-700">${optionLabel}</span>
      </label>
    `;
  }

  html += '</div>';
  return html;
}

/**
 * Render checkbox field
 */
function renderCheckbox(field, value) {
  const checked = value === true || value === 'true' ? 'checked' : '';

  return `
    <label class="flex items-center space-x-2">
      <input
        type="checkbox"
        id="${field.field_name}"
        name="${field.field_name}"
        ${checked}
        class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      <span class="text-sm text-gray-700">${field.checkbox_label || 'Enable'}</span>
    </label>
  `;
}

/**
 * Render file picker field
 */
function renderFilePicker(field, value) {
  return `
    <div class="file-picker-container">
      <input
        type="file"
        id="${field.field_name}"
        name="${field.field_name}"
        class="block w-full text-sm text-gray-500
          file:mr-4 file:py-2 file:px-4
          file:rounded-md file:border-0
          file:text-sm file:font-medium
          file:bg-blue-50 file:text-blue-700
          hover:file:bg-blue-100"
        ${field.multiple ? 'multiple' : ''}
        ${field.accept ? `accept="${field.accept}"` : ''}
      />
      ${value ? `<p class="text-xs text-gray-500 mt-1">Current: ${value}</p>` : ''}
    </div>
  `;
}

/**
 * Attach event handlers for special field types
 */
function attachFieldHandlers(schema, currentConfig) {
  // Directory browser buttons
  document.querySelectorAll('.browse-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fieldName = btn.dataset.field;
      const config = JSON.parse(btn.dataset.config);
      const selectedPath = await openDirectoryBrowser(config);

      if (selectedPath) {
        document.getElementById(fieldName).value = selectedPath;
      }
    });
  });

  // OAuth connect buttons
  document.querySelectorAll('.connect-oauth-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fieldName = btn.dataset.field;
      const provider = btn.dataset.provider;
      const connectorId = schema.connector_id;
      const matterId = currentConfig.matter_id || null; // Get from config if available

      // Initiate OAuth flow with provider, connectorId, and matterId
      const authResult = await initiateOAuthFlow(provider, connectorId, matterId);

      if (authResult) {
        document.getElementById(fieldName).value = authResult.access_token;
        // Re-render to show connected state
        renderConfigurationForm(schema, document.getElementById('connectorConfigForm').parentElement,
          { ...currentConfig, [fieldName]: authResult.access_token });
      }
    });
  });

  // OAuth disconnect buttons
  document.querySelectorAll('.disconnect-oauth-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fieldName = btn.dataset.field;
      document.getElementById(fieldName).value = '';
      // Re-render to show disconnected state
      renderConfigurationForm(schema, document.getElementById('connectorConfigForm').parentElement,
        { ...currentConfig, [fieldName]: '' });
    });
  });

  // Password toggle buttons
  document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
      const fieldName = btn.dataset.field;
      const input = document.getElementById(fieldName);
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });
}

/**
 * Open directory browser modal
 */
async function openDirectoryBrowser(config) {
  return new Promise((resolve) => {
    // This will be implemented to use the existing directory browser modal
    // For now, return a placeholder
    const path = prompt('Enter directory path:');
    resolve(path);
  });
}

/**
 * Initiate OAuth flow using centralized OAuth bridge
 *
 * Flow:
 * 1. Create state token via backend (POST /api/v1/integrations/oauth/states)
 * 2. Build auth URL with the generic OAuth callback URL
 * 3. Open system browser to provider auth URL
 * 4. User authenticates with provider
 * 5. Provider redirects to the configured callback bridge
 * 6. Bridge redirects to lana-ai://oauth/callback (deep link)
 * 7. Electron receives deep link, validates state, sends IPC to renderer
 * 8. Renderer receives callback, exchanges code via backend (POST /api/v1/integrations/oauth/exchange)
 * 9. Backend returns tokens, updates integration_sources
 *
 * @param {string} provider - OAuth provider identifier (e.g., 'google', 'microsoft')
 * @param {string} connectorId - Connector ID for state tracking
 * @param {string} matterId - Matter ID for scoped integration (optional)
 * @returns {Promise<Object|null>} OAuth tokens or null if failed
 */
async function initiateOAuthFlow(provider, connectorId = null, matterId = null) {
  console.log(`Initiating OAuth flow for provider: ${provider}`);

  try {
    // Step 1: Create state token in backend database
    const stateResult = await window.electronAPI.createOAuthState(provider, connectorId, matterId);

    if (!stateResult.success) {
      console.error('Failed to create OAuth state:', stateResult.error);
      alert(`Failed to initiate OAuth: ${stateResult.error}`);
      return null;
    }

    const state = stateResult.state;
    console.log('OAuth state created:', state.substring(0, 8) + '...');

    // For demo mode, return fake tokens
    if (window.api && window.api.isDemoMode && window.api.isDemoMode()) {
      console.log('Demo mode: Returning fake OAuth tokens');
      return {
        access_token: 'demo_token_' + Math.random().toString(36).substring(7),
        refresh_token: 'demo_refresh_' + Math.random().toString(36).substring(7),
        expires_in: 3600
      };
    }

    // Derive the backend URL (where we send the OAuth init/exchange) from the
    // actual saved server. window.api.baseUrl is populated from
    // localStorage.lana_saved_server during ApiClient init, so it holds the
    // user's real backend (e.g. 100.64.0.26:8080, a cloud URL, etc.) — not
    // "localhost:8080" from config.js's dev default.
    let backendUrl = (window.api && window.api.baseUrl) || '';
    if (!backendUrl) {
      try {
        const saved = localStorage.getItem('lana_saved_server');
        if (saved) {
          const info = JSON.parse(saved);
          if (info && info.url) backendUrl = info.url;
        }
      } catch (_) { /* ignore */ }
    }
    if (!backendUrl) {
      const cfg = window.LanaConfig || window.config || {};
      backendUrl = cfg.API_BASE_URL || cfg.apiBaseUrl || '';
    }
    if (!backendUrl) {
      const msg = 'OAuth flow cannot start: no backend URL is configured. Sign in again to set the saved server.';
      console.error(msg);
      alert(msg);
      return null;
    }

    // OAuth providers (Google/Microsoft/etc) require a pre-registered, publicly
    // resolvable redirect_uri. They can't reach localhost, Tailscale IPs, or
    // LAN IPs from their servers, and only the lanaai.io URL is registered in
    // their developer consoles. The bridge (RedRoosterTech-Web → routes/
    // lana-ai-oauth.js) handles the provider redirect and converts it into a
    // lana-ai:// deep link that Electron catches and routes back into the app.
    // Use it unconditionally so dev / Tailscale / cloud all behave the same.
    const redirectUri = 'https://lanaai.io/oauth/callback';

    // Step 3: Build authorization URL with centralized redirect_uri
    // The backend will construct the full OAuth URL with provider-specific params
    const authUrl = `${backendUrl}/api/v1/integrations/oauth/authorize?` +
      `provider=${encodeURIComponent(provider)}&` +
      `state=${encodeURIComponent(state)}&` +
      `connector_id=${encodeURIComponent(connectorId || '')}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}`;

    console.log('Opening OAuth authorization URL...');

    // Step 4: Open system browser to auth URL
    // Use window.open for web, electronAPI for Electron
    if (window.electronAPI && window.electronAPI.invoke) {
      await window.electronAPI.invoke('open-external-url', authUrl);
    } else {
      window.open(authUrl, '_blank');
    }

    // Step 5: Listen for OAuth callback via deep link
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('OAuth flow timed out after 5 minutes'));
      }, 5 * LanaTime.MS_PER_MINUTE); // 5 minute timeout

      const handleOAuthCallback = async (data) => {
        console.log('Received OAuth callback:', data);

        // Validate callback data
        if (!data || !data.code || !data.state) {
          cleanup();
          reject(new Error('Invalid OAuth callback data'));
          return;
        }

        // Validate state matches
        if (data.state !== state) {
          cleanup();
          reject(new Error('OAuth state mismatch - possible CSRF attack'));
          return;
        }

        // Step 6: Exchange code for tokens via backend
        const exchangeResult = await window.electronAPI.exchangeOAuthCode(
          data.code,
          data.state,
          data.provider || provider,
          data.connector_id || connectorId,
          redirectUri,
          data.realmId || data.realm_id || null
        );

        cleanup();

        if (exchangeResult.success) {
          console.log('OAuth flow completed successfully');
          resolve(exchangeResult.data);
        } else {
          console.error('OAuth code exchange failed:', exchangeResult.error);
          reject(new Error(exchangeResult.error || 'Token exchange failed'));
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        // Remove callback listener
        if (window.electronAPI && window.electronAPI.onOAuthCallback) {
          // Note: IPC doesn't provide removeListener, but we can track and ignore
          window._oauthCallbackActive = false;
        }
      };

      // Set up OAuth callback listener
      window._oauthCallbackActive = true;
      if (window.electronAPI && window.electronAPI.onOAuthCallback) {
        window.electronAPI.onOAuthCallback((data) => {
          if (window._oauthCallbackActive) {
            handleOAuthCallback(data);
          }
        });
      } else {
        // Fallback for non-Electron environment
        cleanup();
        reject(new Error('OAuth callbacks not supported in this environment'));
      }
    });

  } catch (error) {
    console.error('OAuth flow error:', error);
    alert(`OAuth authentication failed: ${error.message}`);
    return null;
  }
}

/**
 * Collect form data into a configuration object
 */
function collectFormData(schema) {
  const config = {};

  for (const field of schema.config_fields) {
    const fieldName = field.field_name;

    if (field.type === 'multiselect') {
      // Collect all checked values
      const checkboxes = document.querySelectorAll(`input[name="${fieldName}[]"]:checked`);
      config[fieldName] = Array.from(checkboxes).map(cb => cb.value);
    } else if (field.type === 'checkbox') {
      config[fieldName] = document.getElementById(fieldName)?.checked || false;
    } else {
      config[fieldName] = document.getElementById(fieldName)?.value || '';
    }
  }

  return config;
}

/**
 * Validate configuration against schema
 */
async function validateConfiguration(connectorId, config) {
  try {
    const response = await api.post(`/api/v1/connectors/schemas/${connectorId}/validate`, { config });
    return response;
  } catch (error) {
    console.error('Validation error:', error);
    return {
      valid: false,
      errors: [{ field: 'general', message: 'Failed to validate configuration' }]
    };
  }
}

/**
 * Display validation errors
 */
function displayValidationErrors(errors) {
  // Clear previous errors
  document.querySelectorAll('.field-error').forEach(el => el.remove());

  for (const error of errors) {
    const fieldContainer = document.querySelector(`[data-field="${error.field}"]`);
    if (fieldContainer) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'field-error text-red-500 text-sm mt-1';
      errorDiv.textContent = error.message;
      fieldContainer.appendChild(errorDiv);
    }
  }
}

/**
 * Load schema from API
 */
export async function loadConnectorSchema(connectorId) {
  try {
    const schema = await api.get(`/api/v1/connectors/schemas/${connectorId}`);
    return schema;
  } catch (error) {
    console.error(`Failed to load schema for ${connectorId}:`, error);
    return null;
  }
}

export default {
  renderConfigurationForm,
  loadConnectorSchema
};
