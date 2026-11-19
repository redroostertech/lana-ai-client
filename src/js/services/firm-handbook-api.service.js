/**
 * Firm Handbook API calls (/api/v1/firm-handbook), plus the roles, groups and
 * people lists the visibility editor picks from.
 *
 * Every call goes through the shared api client (window.api), so auth, the
 * server address and error shapes (ApiError: status, code) stay the same as
 * the rest of the app. Responses are returned unwrapped; mapping to view
 * models lives in firm-handbook.models.js.
 *
 *   var handbook = LanaFirmHandbookApi.create(window.api);
 *   handbook.listPublished({ limit: 20, offset: 0, search: 'fees' });
 */
(function (global) {
  'use strict';

  var BASE = '/api/v1/firm-handbook';
  var PICKER_LIMIT = 200;
  var USER_PICKER_PAGE_SIZE = 1000;

  // A { success, data } envelope gives its data; any other body is returned
  // as it is. A structured handbook item has its own `data` field (its typed
  // body), so `data` alone is not an envelope.
  function unwrap(response) {
    var envelope = response && typeof response === 'object' && typeof response.success === 'boolean';
    return envelope && response.data !== undefined && response.data !== null ? response.data : response;
  }

  function itemPath(id, suffix) {
    var value = id === undefined || id === null ? '' : String(id).trim();
    if (!value) throw new Error('A handbook item id is required.');
    return BASE + '/items/' + encodeURIComponent(value) + (suffix || '');
  }

  function query(params) {
    var parts = [];
    Object.keys(params).forEach(function (key) {
      var value = params[key];
      if (value === undefined || value === null || value === '') return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function create(client) {
    function api() {
      var c = client || global.api;
      if (!c || typeof c.get !== 'function') throw new Error('The API client is unavailable.');
      return c;
    }

    function call(method, path, body) {
      var c = api();
      var request = body === undefined ? c[method](path) : c[method](path, body);
      return Promise.resolve(request).then(unwrap);
    }

    return {
      // Members: published items they can see.
      listPublished: function (options) {
        var o = options || {};
        return call('get', BASE + '/items' + query({ limit: o.limit, offset: o.offset, search: o.search }));
      },
      getPublished: function (id) {
        return call('get', itemPath(id));
      },

      // The item types (text and the structured types), declared as data.
      listTypes: function () {
        return call('get', BASE + '/types');
      },
      // The work hours this person's calendar uses (handbook or default).
      workHours: function () {
        return call('get', BASE + '/work-hours');
      },

      // Admins and org admins (the backend checks knowledge:manage).
      listManaged: function (options) {
        var o = options || {};
        return call('get', BASE + '/manage/items' + query({ limit: o.limit, offset: o.offset, search: o.search }));
      },
      // With a file, POST /items is multipart: `file` plus title, summary and
      // visibility as a JSON string. Without one it is a JSON body (a
      // structured item sends kind, data and publish).
      createItem: function (payload, file) {
        if (!file) return call('post', BASE + '/items', payload);
        var p = payload || {};
        var form = new global.FormData();
        form.append('file', file, file.name);
        form.append('title', p.title || '');
        if (p.summary) form.append('summary', p.summary);
        if (p.visibility) form.append('visibility', JSON.stringify(p.visibility));
        return call('post', BASE + '/items', form);
      },
      updateItem: function (id, patch) {
        return call('patch', itemPath(id), patch);
      },
      // A structured item's next version; publish: true also publishes it.
      saveVersion: function (id, data, publish) {
        return call('post', itemPath(id, '/versions'), { data: data, publish: !!publish });
      },
      listVersions: function (id) {
        return call('get', itemPath(id, '/versions'));
      },
      publish: function (id, versionNumber) {
        return call('post', itemPath(id, '/publish'), { version_number: Number(versionNumber) });
      },
      unpublish: function (id) {
        return call('post', itemPath(id, '/unpublish'), {});
      },
      deleteItem: function (id) {
        return call('delete', itemPath(id));
      },
      listPublications: function (id) {
        return call('get', itemPath(id, '/publications'));
      },
      // Restore an older draft version as the current one. The backend
      // re-reads it; it can be published once LANA has finished reading it.
      restoreVersion: function (sourceDocumentId, versionNumber, matterId) {
        var fileId = sourceDocumentId === undefined || sourceDocumentId === null ? '' : String(sourceDocumentId).trim();
        if (!fileId) throw new Error('A handbook document id is required.');
        var version = Number(versionNumber);
        if (!isFinite(version) || version < 1) throw new Error('A version number is required.');
        var path = '/api/v1/storage/files/' + encodeURIComponent(fileId) + '/versions/' + version + '/restore' +
          query({ matter_id: matterId });
        return call('post', path, matterId ? { matter_id: String(matterId) } : {});
      },

      // Visibility recipients.
      listRoles: function () {
        return call('get', '/api/v1/rbac/roles' + query({ limit: PICKER_LIMIT }));
      },
      listGroups: function () {
        return call('get', '/api/v1/groups' + query({ limit: PICKER_LIMIT }));
      },
      listUsers: function () {
        return call('get', '/api/v1/admin/users' + query({ page: 1, page_size: USER_PICKER_PAGE_SIZE }));
      }
    };
  }

  var exported = { BASE: BASE, create: create, unwrap: unwrap };

  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  global.LanaFirmHandbookApi = exported;
})(typeof window !== 'undefined' ? window : globalThis);
