'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE_PATH = path.join(__dirname, '../../src/js/workspace-details.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

function loadMentionHelpers() {
  const start = source.indexOf('  function firstDefined()');
  const end = source.indexOf('  // Escape a string for safe inclusion inside a single-quoted JS string literal');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Unable to locate workspace mention helper block');
  }

  const sandbox = {};
  vm.runInNewContext(`${source.slice(start, end)}
this.normalizeMentionableUsersResponse = normalizeMentionableUsersResponse;`, sandbox, {
    filename: SOURCE_PATH,
  });
  return sandbox;
}

describe('workspace discussion mentions', () => {
  test('normalizes matter mentionable user responses from backend and connector shapes', () => {
    const { normalizeMentionableUsersResponse } = loadMentionHelpers();

    expect(normalizeMentionableUsersResponse({
      data: {
        users: [
          {
            user_id: '23732961-1c8b-4594-8a2e-2f57e88b7dc5',
            user_name: 'Courtney Bennett',
            user_email: 'bennettcl16@gmail.com',
          },
        ],
      },
    })).toEqual([
      {
        id: '23732961-1c8b-4594-8a2e-2f57e88b7dc5',
        name: 'Courtney Bennett',
        email: 'bennettcl16@gmail.com',
        role: '',
      },
    ]);

    expect(normalizeMentionableUsersResponse({
      results: [
        {
          id: 'user-2',
          first_name: 'Ron',
          last_name: 'VanPelt',
          username: 'ron@example.test',
          access_type: 'allow',
        },
      ],
    })).toEqual([
      {
        id: 'user-2',
        name: 'Ron VanPelt',
        email: 'ron@example.test',
        role: 'allow',
      },
    ]);
  });
});
