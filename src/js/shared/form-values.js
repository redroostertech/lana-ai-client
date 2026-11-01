/**
 * form-values.js
 * Exact conversions between what a person types and what the server stores.
 * Used by the server form runner (shared/server-form-fields.js).
 *
 * Public API (window.LanaFormValues, or module.exports in Node):
 *   - decimalToInteger(text, places, message) -> integer in 1/10^places units
 *   - BASIS_POINTS_TOTAL                       -> 10000 (100.00%)
 *   - basisPoints(percentText)                 -> integer basis points
 *   - percentText(basisPoints)                 -> '33.33'
 *   - minorUnits(amountText)                   -> integer cents
 *   - amountText(minorUnits)                   -> '1234.50'
 *   - humanize(key)                            -> 'Trust title' for 'trust_title'
 *   - calendarDate(text)                       -> 'YYYY-MM-DD' or throws
 *   - instant(localText)                       -> ISO string or throws
 *   - localInput(iso)                          -> 'YYYY-MM-DDTHH:mm' for datetime-local
 *   - wholeNumber(text, message)               -> positive integer or throws
 */

(function (global) {
  'use strict';

  function isDigits(text) {
    return Boolean(text) && Array.from(text).every(function (character) {
      return character >= '0' && character <= '9';
    });
  }

  // Parses "12", "12.5" or "12.50" without floating point rounding.
  function decimalToInteger(value, places, message) {
    var parts = String(value == null ? '' : value).trim().split('.');
    if (parts.length > 2 || !isDigits(parts[0]) || (parts.length === 2 && (!isDigits(parts[1]) || parts[1].length > places))) {
      throw new Error(message || 'Enter a number with at most ' + places + ' decimal places.');
    }
    var fraction = (parts[1] || '').padEnd(places, '0');
    var result = Number(parts[0]) * Math.pow(10, places) + Number(fraction || '0');
    if (!Number.isSafeInteger(result)) throw new Error('This number is too large.');
    return result;
  }

  // All of a whole, in basis points (100.00%).
  var BASIS_POINTS_TOTAL = 10000;

  function basisPoints(value) {
    return decimalToInteger(value, 2, 'Enter a percentage with at most two decimal places.');
  }

  function percentText(value) { return (value / 100).toFixed(2); }

  function minorUnits(value) {
    return decimalToInteger(value, 2, 'Enter an amount with at most two decimal places.');
  }

  function amountText(value) { return (value / 100).toFixed(2); }

  function humanize(value) {
    var words = String(value == null ? '' : value).split('_').join(' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function calendarParts(text) {
    var calendar = String(text || '').slice(0, 10).split('-');
    if (calendar.length !== 3 || !calendar.every(isDigits) || calendar[0].length !== 4) return null;
    var year = Number(calendar[0]); var month = Number(calendar[1]); var day = Number(calendar[2]);
    if (month < 1 || month > 12) return null;
    var lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day < 1 || day > lastDay) return null;
    return { year: year, month: month, day: day };
  }

  function calendarDate(value) {
    var text = String(value || '');
    if (text.length !== 10 || !calendarParts(text)) throw new Error('Choose a valid date.');
    return text;
  }

  function instant(value) {
    var text = String(value || '');
    var date = new Date(text);
    if (!calendarParts(text) || text[10] !== 'T' || !Number.isFinite(date.getTime())) throw new Error('Choose a valid date and time.');
    return date.toISOString();
  }

  function localInput(value) {
    if (!value) return '';
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    var part = function (number) { return String(number).padStart(2, '0'); };
    return date.getFullYear() + '-' + part(date.getMonth() + 1) + '-' + part(date.getDate()) + 'T' + part(date.getHours()) + ':' + part(date.getMinutes());
  }

  function wholeNumber(value, message) {
    var number = Number(value);
    if (!isDigits(String(value).trim()) || !Number.isSafeInteger(number) || number < 1) throw new Error(message || 'Enter a positive whole number.');
    return number;
  }

  var moduleApi = {
    BASIS_POINTS_TOTAL: BASIS_POINTS_TOTAL,
    decimalToInteger: decimalToInteger,
    basisPoints: basisPoints,
    percentText: percentText,
    minorUnits: minorUnits,
    amountText: amountText,
    humanize: humanize,
    calendarDate: calendarDate,
    instant: instant,
    localInput: localInput,
    wholeNumber: wholeNumber
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = moduleApi;
  if (global) global.LanaFormValues = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);
