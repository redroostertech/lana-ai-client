'use strict';

function normalizeText(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').normalize('NFC');
}

function matrixToTsv(matrix) {
  if (!Array.isArray(matrix)) throw new Error('A cell matrix is required');
  return matrix.map((row) => {
    if (!Array.isArray(row)) throw new Error('Each matrix row must be an array');
    return row.map((cell) => normalizeText(cell).replace(/[\t\n]+/g, ' ')).join('\t');
  }).join('\n');
}

function actionText(action) {
  if (action.type === 'insert_table') return matrixToTsv(action.arguments.matrix);
  return normalizeText(action.arguments.text);
}

module.exports = { normalizeText, matrixToTsv, actionText };
