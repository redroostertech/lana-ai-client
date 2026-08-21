/*
 * LANA File Editor - sheet-engine.js
 *
 * Pure helpers for MVP spreadsheet behavior. No DOM, no fetch, no eval.
 */
(function (global) {
  'use strict';

  function toText(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function cloneGrid(grid) {
    var rows = Array.isArray(grid) ? grid : [];
    return rows.map(function (row) {
      return Array.isArray(row) ? row.slice() : [];
    });
  }

  function normalizeGrid(grid, minRows, minCols) {
    var rows = cloneGrid(grid);
    var rowCount = Math.max(Number(minRows) || 0, rows.length);
    var colCount = Number(minCols) || 0;
    for (var r = 0; r < rows.length; r += 1) {
      colCount = Math.max(colCount, rows[r].length);
    }
    for (r = 0; r < rowCount; r += 1) {
      if (!rows[r]) rows[r] = [];
      for (var c = 0; c < colCount; c += 1) {
        if (rows[r][c] === undefined || rows[r][c] === null) rows[r][c] = '';
      }
    }
    return rows;
  }

  function columnName(index) {
    var n = Number(index);
    if (!Number.isFinite(n) || n < 0) return '';
    var name = '';
    n += 1;
    while (n > 0) {
      var rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function cellRef(row, col) {
    return columnName(col) + String(Number(row) + 1);
  }

  function parseCellRef(ref) {
    var value = toText(ref).trim().toUpperCase();
    if (!value) return null;
    var match = /^\$?([A-Z]+)\$?([1-9][0-9]*)$/.exec(value);
    if (!match) return null;
    var col = 0;
    for (var i = 0; i < match[1].length; i += 1) {
      var code = match[1].charCodeAt(i);
      col = (col * 26) + (code - 64);
    }
    var rowText = match[2];
    var row = Number(rowText);
    return { row: row - 1, col: col - 1 };
  }

  function getRaw(grid, ref) {
    var parsed = parseCellRef(ref);
    if (!parsed || !grid[parsed.row]) return '';
    return grid[parsed.row][parsed.col] === undefined ? '' : grid[parsed.row][parsed.col];
  }

  function rangeRefs(range) {
    var parts = toText(range).split(':');
    if (parts.length > 2) return [];
    var start = parseCellRef(parts[0]);
    var end = parseCellRef(parts[1] || parts[0]);
    var refs = [];
    if (!start || !end) return refs;
    for (var row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
      for (var col = Math.min(start.col, end.col); col <= Math.max(start.col, end.col); col += 1) {
        refs.push(cellRef(row, col));
      }
    }
    return refs;
  }

  function makeValue(value, source) {
    var result = { value: value, error: '' };
    if (source) result.source = source;
    return result;
  }

  function makeRange(refs) {
    return { value: 0, refs: refs, error: '' };
  }

  function makeError(value, code) {
    return { value: value, error: code };
  }

  function isErrorResult(result) {
    return result && result.error;
  }

  function tokenizeFormula(text) {
    var tokens = [];
    var expr = toText(text);
    var i = 0;
    while (i < expr.length) {
      var ch = expr.charAt(i);
      if (/\s/.test(ch)) {
        i += 1;
      } else if (/[0-9.]/.test(ch)) {
        var start = i;
        var hasDigits = false;
        while (/[0-9]/.test(expr.charAt(i))) {
          hasDigits = true;
          i += 1;
        }
        if (expr.charAt(i) === '.') {
          i += 1;
          while (/[0-9]/.test(expr.charAt(i))) {
            hasDigits = true;
            i += 1;
          }
        }
        if (!hasDigits) return { tokens: [], error: 'VALUE' };
        if (/[eE]/.test(expr.charAt(i))) {
          var exponentStart = i;
          i += 1;
          if (/[+-]/.test(expr.charAt(i))) i += 1;
          var exponentDigits = false;
          while (/[0-9]/.test(expr.charAt(i))) {
            exponentDigits = true;
            i += 1;
          }
          if (!exponentDigits) i = exponentStart;
        }
        tokens.push({ type: 'number', value: Number(expr.slice(start, i)) });
      } else if (/[A-Za-z_$]/.test(ch)) {
        start = i;
        while (/[A-Za-z0-9_$]/.test(expr.charAt(i))) i += 1;
        var word = expr.slice(start, i);
        var ref = parseCellRef(word);
        tokens.push(ref ? { type: 'ref', value: word, ref: ref } : { type: 'ident', value: word.toUpperCase() });
      } else if (ch === '(' || ch === ')' || ch === ',' || ch === ':' || ch === '+' || ch === '-' || ch === '*' || ch === '/') {
        tokens.push({ type: ch, value: ch });
        i += 1;
      } else {
        return { tokens: [], error: 'VALUE' };
      }
    }
    tokens.push({ type: 'eof', value: '' });
    return { tokens: tokens, error: '' };
  }

  function coerceNumber(result) {
    if (isErrorResult(result)) return result;
    if (result && result.refs) return makeError('#VALUE!', 'VALUE');
    var value = result ? result.value : '';
    if (value === null || value === undefined) return makeValue(0);
    if (typeof value === 'number') return Number.isFinite(value) ? makeValue(value) : makeError('#VALUE!', 'VALUE');
    var text = toText(value).trim();
    if (text === '') return makeValue(0);
    var numeric = Number(text);
    return Number.isFinite(numeric) ? makeValue(numeric) : makeError('#VALUE!', 'VALUE');
  }

  function numericAggregateValues(grid, args, seen) {
    var values = [];
    for (var a = 0; a < args.length; a += 1) {
      var arg = args[a];
      if (isErrorResult(arg)) return arg;
      if (arg && arg.refs) {
        for (var r = 0; r < arg.refs.length; r += 1) {
          var cell = parseCellRef(arg.refs[r]);
          var evaluated = evaluateCell(grid, cell.row, cell.col, seen);
          if (isErrorResult(evaluated)) return evaluated;
          var text = toText(evaluated.value).trim();
          var numeric = Number(text);
          if (text !== '' && Number.isFinite(numeric)) values.push(numeric);
        }
      } else if (arg && arg.source === 'cell') {
        text = toText(arg.value).trim();
        numeric = Number(text);
        if (text !== '' && Number.isFinite(numeric)) values.push(numeric);
      } else {
        var scalar = coerceNumber(arg);
        if (isErrorResult(scalar)) return scalar;
        values.push(scalar.value);
      }
    }
    return makeValue(values);
  }

  function applyFunction(name, grid, args, seen) {
    var fn = name === 'AVERAGE' ? 'AVG' : name;
    var collected = numericAggregateValues(grid, args, seen);
    if (isErrorResult(collected)) return collected;
    var values = collected.value;
    if (fn === 'SUM') {
      return makeValue(values.reduce(function (a, b) { return a + b; }, 0));
    }
    if (fn === 'AVG') {
      return makeValue(values.length ? values.reduce(function (a, b) { return a + b; }, 0) / values.length : 0);
    }
    if (fn === 'MIN') return makeValue(values.length ? Math.min.apply(Math, values) : 0);
    if (fn === 'MAX') return makeValue(values.length ? Math.max.apply(Math, values) : 0);
    if (fn === 'COUNT') return makeValue(values.length);
    return makeError('#NAME?', 'NAME');
  }

  function FormulaParser(grid, tokens, seen) {
    this.grid = Array.isArray(grid) ? grid : [];
    this.tokens = tokens;
    this.seen = seen || {};
    this.index = 0;
  }

  FormulaParser.prototype.peek = function () {
    return this.tokens[this.index] || { type: 'eof', value: '' };
  };

  FormulaParser.prototype.next = function () {
    var token = this.peek();
    this.index += 1;
    return token;
  };

  FormulaParser.prototype.match = function (type) {
    if (this.peek().type !== type) return false;
    this.index += 1;
    return true;
  };

  FormulaParser.prototype.parse = function () {
    var result = this.parseAddSub();
    if (isErrorResult(result)) return result;
    if (this.peek().type !== 'eof') return makeError('#VALUE!', 'VALUE');
    if (result && result.refs) return makeError('#VALUE!', 'VALUE');
    return result;
  };

  FormulaParser.prototype.parseAddSub = function () {
    var left = this.parseMulDiv();
    while (!isErrorResult(left) && (this.peek().type === '+' || this.peek().type === '-')) {
      var op = this.next().type;
      var right = this.parseMulDiv();
      left = this.applyBinary(op, left, right);
    }
    return left;
  };

  FormulaParser.prototype.parseMulDiv = function () {
    var left = this.parseUnary();
    while (!isErrorResult(left) && (this.peek().type === '*' || this.peek().type === '/')) {
      var op = this.next().type;
      var right = this.parseUnary();
      left = this.applyBinary(op, left, right);
    }
    return left;
  };

  FormulaParser.prototype.parseUnary = function () {
    if (this.match('+')) return this.parseUnary();
    if (this.match('-')) {
      var value = coerceNumber(this.parseUnary());
      return isErrorResult(value) ? value : makeValue(-value.value);
    }
    return this.parsePrimary();
  };

  FormulaParser.prototype.parsePrimary = function () {
    var token = this.next();
    if (token.type === 'number') return makeValue(token.value);
    if (token.type === 'ref') {
      if (this.match(':')) {
        var end = this.next();
        if (end.type !== 'ref') return makeError('#VALUE!', 'VALUE');
        return makeRange(rangeRefs(token.value + ':' + end.value));
      }
      var evaluated = evaluateCell(this.grid, token.ref.row, token.ref.col, this.seen);
      if (isErrorResult(evaluated)) return evaluated;
      return makeValue(evaluated.value, 'cell');
    }
    if (token.type === 'ident') {
      if (!this.match('(')) return makeError('#NAME?', 'NAME');
      return this.parseFunction(token.value);
    }
    if (token.type === '(') {
      var grouped = this.parseAddSub();
      if (isErrorResult(grouped)) return grouped;
      return this.match(')') ? grouped : makeError('#VALUE!', 'VALUE');
    }
    return makeError('#VALUE!', 'VALUE');
  };

  FormulaParser.prototype.parseFunction = function (name) {
    var args = [];
    if (this.match(')')) return applyFunction(name, this.grid, args, this.seen);
    while (this.peek().type !== 'eof') {
      args.push(this.parseAddSub());
      if (this.match(')')) return applyFunction(name, this.grid, args, this.seen);
      if (!this.match(',')) return makeError('#VALUE!', 'VALUE');
    }
    return makeError('#VALUE!', 'VALUE');
  };

  FormulaParser.prototype.applyBinary = function (op, left, right) {
    var leftNumber = coerceNumber(left);
    if (isErrorResult(leftNumber)) return leftNumber;
    var rightNumber = coerceNumber(right);
    if (isErrorResult(rightNumber)) return rightNumber;
    if (op === '+') return makeValue(leftNumber.value + rightNumber.value);
    if (op === '-') return makeValue(leftNumber.value - rightNumber.value);
    if (op === '*') return makeValue(leftNumber.value * rightNumber.value);
    if (op === '/') return rightNumber.value === 0 ? makeError('#DIV/0!', 'DIV0') : makeValue(leftNumber.value / rightNumber.value);
    return makeError('#VALUE!', 'VALUE');
  }

  function evaluateFormula(grid, formula, seen) {
    var expr = toText(formula).trim();
    if (expr.charAt(0) === '=') expr = expr.slice(1).trim();
    if (!expr) return { value: '', error: '' };
    var tokenized = tokenizeFormula(expr);
    if (tokenized.error) return makeError('#VALUE!', tokenized.error);
    return new FormulaParser(grid, tokenized.tokens, seen).parse();
  }

  function evaluateCell(grid, row, col, seen) {
    var safeGrid = Array.isArray(grid) ? grid : [];
    var key = cellRef(row, col);
    var chain = seen || {};
    if (chain[key]) return { value: '#CYCLE!', error: 'CYCLE' };
    var raw = safeGrid[row] && safeGrid[row][col] !== undefined ? safeGrid[row][col] : '';
    if (toText(raw).trim().charAt(0) !== '=') return { value: raw, raw: raw, error: '' };
    var nextSeen = Object.assign({}, chain);
    nextSeen[key] = true;
    var evaluated = evaluateFormula(safeGrid, raw, nextSeen);
    evaluated.raw = raw;
    return evaluated;
  }

  function displayCell(grid, row, col) {
    var evaluated = evaluateCell(grid, row, col);
    if (typeof evaluated.value === 'number' && Number.isFinite(evaluated.value)) {
      var rounded = Math.round(evaluated.value * 1000000) / 1000000;
      return String(rounded);
    }
    return toText(evaluated.value);
  }

  function escapeCsvCell(value) {
    var text = toText(value);
    var needsQuotes = text.indexOf(',') !== -1 || text.indexOf('"') !== -1 || text.indexOf('\n') !== -1 || text.indexOf('\r') !== -1;
    if (!needsQuotes) return text;
    return '"' + text.split('"').join('""') + '"';
  }

  function exportCsv(grid, options) {
    var opts = options || {};
    var rows = normalizeGrid(grid, 0, 0);
    return rows.map(function (row, r) {
      return row.map(function (value, c) {
        return escapeCsvCell(opts.computed ? displayCell(rows, r, c) : value);
      }).join(',');
    }).join('\n');
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var cell = '';
    var inQuotes = false;
    var value = toText(text);
    for (var i = 0; i < value.length; i += 1) {
      var ch = value.charAt(i);
      var next = value.charAt(i + 1);
      if (inQuotes && ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes && ch === ',') {
        row.push(cell);
        cell = '';
      } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
        if (ch === '\r' && next === '\n') i += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
    row.push(cell);
    rows.push(row);
    if (rows.length === 1 && rows[0].length === 1 && rows[0][0] === '') return [];
    return rows;
  }

  var api = {
    normalizeGrid: normalizeGrid,
    columnName: columnName,
    cellRef: cellRef,
    parseCellRef: parseCellRef,
    rangeRefs: rangeRefs,
    evaluateFormula: evaluateFormula,
    evaluateCell: evaluateCell,
    displayCell: displayCell,
    exportCsv: exportCsv,
    parseCsv: parseCsv
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LanaFileEditorSheetEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
