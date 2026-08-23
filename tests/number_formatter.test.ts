const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const formatterUrl = pathToFileURL(path.resolve(__dirname, '../assets/scripts/presentation/NumberFormatter.ts')).href;

test('compact formatter covers unit boundaries deterministically', async () => {
    const { formatCompactNumber } = await import(formatterUrl);
    assert.equal(formatCompactNumber(0), '0');
    assert.equal(formatCompactNumber(999), '999');
    assert.equal(formatCompactNumber(1000), '1K');
    assert.equal(formatCompactNumber(1500), '1.5K');
    assert.equal(formatCompactNumber(1_000_000), '1M');
    assert.equal(formatCompactNumber(1_000_000_000), '1B');
    assert.equal(formatCompactNumber(1_000_000_000_000), '1T');
    assert.equal(formatCompactNumber(-2500), '-2.5K');
});
