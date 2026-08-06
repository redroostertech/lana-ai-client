/* Admin Console - terminal-style admin workspace.
   Uses the server runtime when available, with a clearly labeled local preview fallback. */

(function () {
  'use strict';

  var history = [];
  var historyIndex = -1;
  var taskCounter = 0;
  var runtimeMode = 'local';
  var lastServerStatus = null;

  var FALLBACK_STATUSES = [0, 404, 408, 502, 503, 504];
  var NON_FALLBACK_STATUSES = [400, 401, 403];
  var LOCAL_COMMAND_CATALOG = [
    { command: 'help', label: 'help', icon: 'circle-help' },
    { command: 'lana status', label: 'lana status', icon: 'activity' },
    { command: 'lana org current', label: 'lana org current', icon: 'building-2' },
    { command: 'lana connectors status', label: 'lana connectors status', icon: 'plug' },
    { command: 'lana logs api --since 15m', label: 'lana logs api --since 15m', icon: 'scroll-text' },
    { command: 'lana agent run "audit this org"', label: 'lana agent run "audit this org"', icon: 'bot' }
  ];

  function el(id) {
    return document.getElementById(id);
  }

  function getUser() {
    return (typeof api !== 'undefined' && api.user) ? api.user : {};
  }

  function hasConsoleAccess() {
    return !!(window.Lex && Lex.Auth && (
      Lex.Auth.hasRole('system_admin') ||
      Lex.Auth.hasRole('org_admin')
    ));
  }

  function getRoleLabel() {
    if (Lex.Auth.hasRole('system_admin')) return 'System admin';
    if (Lex.Auth.hasRole('org_admin')) return 'Org admin';
    return 'Admin';
  }

  function getScopeLabel() {
    if (Lex.Auth.hasRole('system_admin')) return 'System';
    return 'Organization';
  }

  function getUserLabel(user) {
    return user.name || user.full_name || user.email || user.id || 'Current user';
  }

  function escapeText(value) {
    return String(value == null ? '' : value);
  }

  function nowLabel() {
    return LanaTime.nowDate().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  function appendLine(kind, content, prefix) {
    var output = el('consoleOutput');
    if (!output) return;

    var row = document.createElement('div');
    row.className = 'admin-console-line admin-console-line--' + kind;

    var time = document.createElement('time');
    time.textContent = nowLabel();

    var text = document.createElement('span');
    if (prefix) {
      var strong = document.createElement('strong');
      strong.textContent = prefix + ' ';
      text.appendChild(strong);
    }
    text.appendChild(document.createTextNode(escapeText(content)));

    row.appendChild(time);
    row.appendChild(text);
    output.appendChild(row);
    output.scrollTop = output.scrollHeight;
  }

  function setBadge(id, label, color) {
    var badge = el(id);
    if (!badge) return;
    badge.setAttribute('label', label);
    badge.setAttribute('color', color);
  }

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value;
  }

  function setRuntimeMode(mode, detail) {
    runtimeMode = mode || runtimeMode;

    if (runtimeMode === 'server') {
      setBadge('consoleModeBadge', 'Server runtime', 'green');
      setText('consoleRuntimeLabel', detail || 'Server runtime');
      return;
    }

    if (runtimeMode === 'error') {
      setBadge('consoleModeBadge', 'Server error', 'red');
      setText('consoleRuntimeLabel', detail || 'Server rejected command');
      return;
    }

    setBadge('consoleModeBadge', 'Local preview', 'amber');
    setText('consoleRuntimeLabel', detail || 'Local preview fallback');
  }

  function addTask(title, status) {
    var list = el('consoleTaskList');
    if (!list) return null;

    taskCounter += 1;
    var task = document.createElement('div');
    task.className = 'admin-console-task';
    task.dataset.taskId = String(taskCounter);

    var strong = document.createElement('strong');
    strong.textContent = title;

    var span = document.createElement('span');
    span.textContent = status || 'queued';

    task.appendChild(strong);
    task.appendChild(span);
    list.prepend(task);
    return task;
  }

  function updateTask(task, status) {
    if (!task) return;
    var span = task.querySelector('span');
    if (span) span.textContent = status;
  }

  function clearTasks() {
    var list = el('consoleTaskList');
    if (list) list.innerHTML = '';
  }

  function renderCommandCatalog(commands) {
    var list = el('consoleCommandList');
    if (!list || !Array.isArray(commands) || !commands.length) return;

    list.innerHTML = '';
    commands.forEach(function (entry) {
      if (!entry || !entry.command) return;

      var button = document.createElement('lex-btn');
      button.setAttribute('variant', 'ghost');
      button.setAttribute('size', 'sm');
      button.setAttribute('leading-icon', entry.icon || 'terminal');
      button.dataset.command = entry.command;
      if (entry.description) {
        button.setAttribute('title', entry.description);
      }
      button.textContent = entry.label || entry.command;
      list.appendChild(button);
    });
  }

  async function loadCommandCatalog() {
    renderCommandCatalog(LOCAL_COMMAND_CATALOG);

    if (typeof api === 'undefined' || !api || typeof api.get !== 'function') {
      return;
    }

    try {
      var response = await api.get('/api/v1/admin/console/commands');
      var payload = response && response.data ? response.data : response;
      var data = payload && payload.data ? payload.data : payload;
      if (data && Array.isArray(data.commands)) {
        renderCommandCatalog(data.commands);
      }
    } catch (error) {
      if (!shouldUseLocalFallback(error)) {
        var status = getErrorStatus(error);
        appendLine('warn', '[server runtime warning]\nCommand catalog unavailable' + (status ? ' (' + status + ')' : '') + '.');
      }
    }
  }

  function localCommandResult(command) {
    var normalized = command.trim().toLowerCase();
    var role = getRoleLabel();
    var scope = getScopeLabel();

    if (normalized === 'help') {
      return {
        kind: 'system',
        content: [
        '[local preview]',
        'Available preview commands:',
        '  help',
        '  clear',
        '  lana status',
        '  lana org current',
        '  lana connectors status',
        '  lana logs api --since 15m',
        '  lana agent run "audit this org"',
        '',
        'This console is wired as a guided admin surface. Backend execution will run through scoped tools, policy checks, and audit logging.'
        ].join('\n')
      };
    }

    if (normalized === 'lana status') {
      return {
        kind: 'system',
        content: [
        '[local preview]',
        'LANA stack: connected',
        'API runtime: reachable from client session',
        'Role: ' + role,
        'Scope: ' + scope,
        'Execution mode: local preview fallback'
        ].join('\n')
      };
    }

    if (normalized === 'lana org current') {
      var user = getUser();
      return {
        kind: 'system',
        content: [
        '[local preview]',
        'Organization scope: ' + (user.organization_name || user.org_name || user.organization_id || 'current organization'),
        'User: ' + getUserLabel(user),
        'Role: ' + role
        ].join('\n')
      };
    }

    if (normalized === 'lana connectors status') {
      return {
        kind: 'system',
        content: [
        '[local preview]',
        'Connector status preview:',
        '  leadly        ready',
        '  gmail         available',
        '  insights      indexed',
        '',
        'Live connector checks require the backend admin-console tool runtime.'
        ].join('\n')
      };
    }

    if (normalized.indexOf('lana logs api') === 0) {
      return {
        kind: 'system',
        content: [
        '[local preview]',
        'API logs preview:',
        '  15m window selected',
        '  errors: unavailable in preview',
        '  warnings: unavailable in preview',
        '',
        'Live logs will stream from the audited console runtime.'
        ].join('\n')
      };
    }

    if (normalized.indexOf('lana agent run') === 0) {
      return {
        kind: 'system',
        content: [
        '[local preview]',
        'Agent task preview prepared locally.',
        'Runtime dispatch: not started',
        'Planned runtime path:',
        '  1. create admin_console_session',
        '  2. apply role and org scope',
        '  3. dispatch approved diagnostic tools',
        '  4. stream transcript events back to this console'
        ].join('\n')
      };
    }

    return {
      kind: 'error',
      content: [
        '[local preview error]',
        'Unsupported command: ' + command,
        'Type help to see supported commands.'
      ].join('\n')
    };
  }

  async function executeServerCommand(command) {
    if (typeof api === 'undefined' || !api || typeof api.post !== 'function') {
      return { fallback: true, reason: 'API client unavailable' };
    }

    try {
      var response = await api.post('/api/v1/admin/console/commands', { command: command });
      var payload = response && response.data ? response.data : response;
      lastServerStatus = 200;
      setRuntimeMode('server', 'Server runtime');
      return { payload: payload };
    } catch (error) {
      var status = getErrorStatus(error);
      lastServerStatus = status;

      if (shouldUseLocalFallback(error)) {
        return {
          fallback: true,
          reason: status ? ('Server runtime unavailable (' + status + ')') : 'Server runtime unavailable',
          message: getServerErrorMessage(error)
        };
      }

      if (NON_FALLBACK_STATUSES.indexOf(status) !== -1) {
        setRuntimeMode('error', 'Server rejected command (' + status + ')');
        return {
          error: true,
          status: status,
          message: getServerErrorMessage(error)
        };
      }

      setRuntimeMode('error', status ? ('Server error (' + status + ')') : 'Server error');
      return { error: true, status: status, message: getServerErrorMessage(error) };
    }
  }

  function appendServerResult(result) {
    if (!result) return false;

    if (Array.isArray(result.lines)) {
      appendLine('system', ['[server runtime]'].concat(result.lines).join('\n'));
      return true;
    }

    if (result.output || result.message) {
      appendLine('system', '[server runtime]\n' + (result.output || result.message));
      return true;
    }

    return true;
  }

  function transcriptTimestamp(entry) {
    var raw = entry && (entry.occurred_at || entry.created_at);
    if (!raw) return 'recorded';
    try {
      return new Date(raw).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch (_) {
      return 'recorded';
    }
  }

  function appendTranscriptEntry(entry) {
    if (!entry || !entry.command) return;
    var failed = entry.type === 'command_failed';
    if (entry.type !== 'command_completed' && !failed) return;

    var content = [
      '[' + (failed ? 'server transcript error' : 'server transcript') + '] ' + transcriptTimestamp(entry),
      '$ ' + entry.command
    ];

    if (Array.isArray(entry.lines) && entry.lines.length) {
      content = content.concat(entry.lines);
    }

    if (failed && entry.error && entry.error.message) {
      content.push(entry.error.message);
    }

    appendLine(failed ? 'error' : 'system', content.join('\n'));

    if (entry.task && entry.task.title) {
      addTask(entry.task.title, entry.task.status || entry.task.phase || 'recorded');
    }
  }

  async function loadRecentTranscript() {
    if (typeof api === 'undefined' || !api || typeof api.get !== 'function') {
      setRuntimeMode('local', 'Local preview fallback');
      appendLine('warn', '[local preview fallback]\nAPI client unavailable. Recent server transcript was not loaded.');
      return;
    }

    try {
      var response = await api.get('/api/v1/admin/console/transcript?limit=8');
      var payload = response && response.data ? response.data : response;
      var data = payload && payload.data ? payload.data : payload;
      var entries = data && Array.isArray(data.entries) ? data.entries : [];

      setRuntimeMode('server', 'Server runtime');
      if (!entries.length) {
        appendLine('system', '[server runtime]\nNo recent console transcript entries for this scope.');
        return;
      }

      entries.slice().reverse().forEach(appendTranscriptEntry);
    } catch (error) {
      var status = getErrorStatus(error);
      if (shouldUseLocalFallback(error)) {
        setRuntimeMode('local', 'Local preview fallback');
        appendLine('warn', '[local preview fallback]\nRecent server transcript unavailable' + (status ? ' (' + status + ')' : '') + '.');
        return;
      }

      setRuntimeMode('error', status ? ('Server rejected transcript request (' + status + ')') : 'Server transcript error');
      appendLine('error', '[server runtime error]\n' + getServerErrorMessage(error));
    }
  }

  function getErrorStatus(error) {
    var status = Number(error && error.status);
    return Number.isFinite(status) ? status : 0;
  }

  function shouldUseLocalFallback(error) {
    var status = getErrorStatus(error);
    return FALLBACK_STATUSES.indexOf(status) !== -1 && NON_FALLBACK_STATUSES.indexOf(status) === -1;
  }

  function getServerErrorMessage(error) {
    var data = error && error.data;
    return (data && data.error && data.error.message) ||
      (data && data.detail) ||
      (data && data.message) ||
      (error && error.message) ||
      'Server command failed';
  }

  function appendLocalResult(command, fallback) {
    if (fallback) {
      setRuntimeMode('local', 'Local preview fallback');
      appendLine('warn', '[local preview fallback]\n' + fallback.reason + '. ' + (fallback.message || ''));
    }

    var localResult = localCommandResult(command);
    appendLine(localResult.kind, localResult.content);
    return localResult.kind !== 'error';
  }

  function runCommand(command) {
    var trimmed = command.trim();
    if (!trimmed) return;

    history.push(trimmed);
    historyIndex = history.length;

    appendLine('command', trimmed, 'lana $');

    if (trimmed.toLowerCase() === 'clear') {
      clearConsole();
      return;
    }

    var task = null;
    if (trimmed.toLowerCase().indexOf('lana agent run') === 0) {
      task = addTask('Agent diagnostic', 'running');
    } else {
      task = addTask(trimmed, 'complete');
    }

    window.setTimeout(async function () {
      var result = await executeServerCommand(trimmed);
      var success = true;

      if (result && result.error) {
        appendLine('error', [
          '[server runtime error]',
          (result.status ? 'HTTP ' + result.status + ': ' : '') + result.message
        ].join('\n'));
        success = false;
      } else if (result && result.fallback) {
        success = appendLocalResult(trimmed, result);
      } else if (!appendServerResult(result && result.payload)) {
        success = appendLocalResult(trimmed);
      }

      updateTask(task, success ? 'complete' : 'error');
    }, task && trimmed.toLowerCase().indexOf('lana agent run') === 0 ? 550 : 120);
  }

  function clearConsole() {
    var output = el('consoleOutput');
    if (output) output.innerHTML = '';
    clearTasks();
    appendLine('system', '[' + (runtimeMode === 'server' ? 'server runtime' : 'local preview') + ']\nConsole cleared. Type help to list commands.');
  }

  function copyConsole() {
    var output = el('consoleOutput');
    var text = output ? output.innerText : '';
    if (!text) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        appendLine('system', 'Console transcript copied.');
      }).catch(function () {
        appendLine('warn', 'Clipboard unavailable in this context.');
      });
    } else {
      appendLine('warn', 'Clipboard unavailable in this context.');
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    var input = el('consoleInput');
    if (!input) return;
    var command = input.value;
    input.value = '';
    runCommand(command);
  }

  function onKeydown(event) {
    var input = el('consoleInput');
    if (!input) return;

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (history.length === 0) return;
      historyIndex = Math.max(0, historyIndex - 1);
      input.value = history[historyIndex] || '';
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (history.length === 0) return;
      historyIndex = Math.min(history.length, historyIndex + 1);
      input.value = history[historyIndex] || '';
    }
  }

  function onCommandButton(event) {
    var button = event.target.closest('[data-command]');
    if (!button) return;
    var input = el('consoleInput');
    if (input) {
      input.value = button.dataset.command || '';
      input.focus();
    }
    runCommand(button.dataset.command || '');
  }

  function hydrateUserContext() {
    var user = getUser();
    var role = getRoleLabel();

    setBadge('consoleRoleBadge', role, Lex.Auth.hasRole('system_admin') ? 'indigo' : 'blue');
    setText('consoleScopeLabel', getScopeLabel());
    setText('consoleUserLabel', getUserLabel(user));
    setRuntimeMode('server', 'Server runtime pending');
    setText('consolePromptLabel', Lex.Auth.hasRole('system_admin') ? 'lana # ' : 'lana $ ');
  }

  function init() {
    var content = el('lex-main-content');
    if (!content) return;

    if (!hasConsoleAccess()) {
      Lex.Nav.go('admin/index.html', { replace: true });
      return;
    }

    hydrateUserContext();

    var form = el('consoleForm');
    var input = el('consoleInput');
    var clear = el('consoleClearBtn');
    var copy = el('consoleCopyBtn');
    var commands = document.querySelector('.admin-console-command-list');

    if (form) form.addEventListener('submit', onSubmit);
    if (input) input.addEventListener('keydown', onKeydown);
    if (clear) clear.addEventListener('click', clearConsole);
    if (copy) copy.addEventListener('click', copyConsole);
    if (commands) commands.addEventListener('click', onCommandButton);

    loadCommandCatalog();
    appendLine('system', '[server runtime]\nConsole session opened. Commands run through the audited server runtime.');
    appendLine('system', 'Loading recent transcript for this scope.');
    appendLine('system', 'Type help to list commands.');
    loadRecentTranscript();

    if (input) input.focus();
  }

  init();
})();
