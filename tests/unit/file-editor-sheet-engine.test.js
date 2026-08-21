const path = require('path');

const sheet = require(path.join(
  __dirname,
  '../../src/js/file-editor/sheet-engine.js'
));

describe('file-editor sheet engine', () => {
  test('parses multi-letter cell references and builds refs', () => {
    expect(sheet.parseCellRef('A1')).toEqual({ row: 0, col: 0 });
    expect(sheet.parseCellRef('$b$2')).toEqual({ row: 1, col: 1 });
    expect(sheet.parseCellRef('AA12')).toEqual({ row: 11, col: 26 });
    expect(sheet.cellRef(11, 26)).toBe('AA12');
    expect(sheet.parseCellRef('1A')).toBeNull();
  });

  test('expands ranges left-to-right and top-to-bottom', () => {
    expect(sheet.rangeRefs('B2:C3')).toEqual(['B2', 'C2', 'B3', 'C3']);
    expect(sheet.rangeRefs('C3:B2')).toEqual(['B2', 'C2', 'B3', 'C3']);
  });

  test('evaluates arithmetic and aggregate formulas without eval', () => {
    const grid = [
      ['Item', 'Estimate', 'Actual'],
      ['A', '10', '7'],
      ['B', '20', '18'],
      ['Total', '=SUM(B2:B3)', '=SUM(C2:C3)'],
      ['Variance', '=B4-C4', '=AVG(B2:C3)']
    ];

    expect(sheet.displayCell(grid, 3, 1)).toBe('30');
    expect(sheet.displayCell(grid, 3, 2)).toBe('25');
    expect(sheet.displayCell(grid, 4, 0)).toBe('Variance');
    expect(sheet.displayCell(grid, 4, 1)).toBe('5');
    expect(sheet.displayCell(grid, 4, 2)).toBe('13.75');
  });

  test('honors spreadsheet arithmetic precedence, parentheses, and unary signs', () => {
    const grid = [
      ['2', '3', '=A1+B1*4', '=(A1+B1)*4'],
      ['=-A1+B1', '=-(A1+B1)', '=A1/B1', '=A1*(B1+7)']
    ];

    expect(sheet.displayCell(grid, 0, 2)).toBe('14');
    expect(sheet.displayCell(grid, 0, 3)).toBe('20');
    expect(sheet.displayCell(grid, 1, 0)).toBe('1');
    expect(sheet.displayCell(grid, 1, 1)).toBe('-5');
    expect(sheet.displayCell(grid, 1, 2)).toBe('0.666667');
    expect(sheet.displayCell(grid, 1, 3)).toBe('20');
  });

  test('supports nested functions and common average alias', () => {
    const grid = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['=SUM(A1:A2, MAX(B1:C2), AVERAGE(A1:C1))']
    ];

    expect(sheet.displayCell(grid, 2, 0)).toBe('13');
  });

  test('matches spreadsheet aggregate handling for blanks and text cells', () => {
    const grid = [
      ['Label', '', '3'],
      ['=SUM(A1:C1)', '=COUNT(A1:C1)', '=A1+1'],
      ['=SUM(A1, C1, 2)', '=COUNT(A1, C1, 2)', '=MIN(A1:C1)']
    ];

    expect(sheet.displayCell(grid, 1, 0)).toBe('3');
    expect(sheet.displayCell(grid, 1, 1)).toBe('1');
    expect(sheet.evaluateCell(grid, 1, 2)).toMatchObject({ value: '#VALUE!', error: 'VALUE' });
    expect(sheet.displayCell(grid, 2, 0)).toBe('5');
    expect(sheet.displayCell(grid, 2, 1)).toBe('2');
    expect(sheet.displayCell(grid, 2, 2)).toBe('3');
  });

  test('returns explicit errors for divide-by-zero and cycles', () => {
    const div = [['=B1/0', '4']];
    expect(sheet.evaluateCell(div, 0, 0)).toMatchObject({ value: '#DIV/0!', error: 'DIV0' });

    const cycle = [['=B1', '=A1']];
    expect(sheet.evaluateCell(cycle, 0, 0)).toMatchObject({ value: '#CYCLE!', error: 'CYCLE' });

    const invalid = [['=NOPE(1)', '=A2:B3+1']];
    expect(sheet.evaluateCell(invalid, 0, 0)).toMatchObject({ value: '#NAME?', error: 'NAME' });
    expect(sheet.evaluateCell(invalid, 0, 1)).toMatchObject({ value: '#VALUE!', error: 'VALUE' });
  });

  test('round-trips CSV with quotes, commas, and formulas', () => {
    const grid = [
      ['Name', 'Note', 'Value'],
      ['Alpha', 'One, Two', '10'],
      ['Beta', 'Said "yes"', '=C2*2']
    ];
    const csv = sheet.exportCsv(grid);
    expect(csv).toBe('Name,Note,Value\nAlpha,"One, Two",10\nBeta,"Said ""yes""",=C2*2');
    expect(sheet.parseCsv(csv)).toEqual(grid);
  });

  test('can export computed CSV values', () => {
    const grid = [['A', 'B'], ['4', '=A2*2']];
    expect(sheet.exportCsv(grid, { computed: true })).toBe('A,B\n4,8');
  });
});
