import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHostFault, removalHostPreflight } from './removal-host-preflight.mjs';

test('memory tracker requires a single recovered write fault with the write bit set', () => {
  assert.deepEqual(validateHostFault({ faults: 1, writeBit: 1, recovered: true }),
    { faults: 1, writeBit: 1, recovered: true });
});
test('missing write metadata and unobserved faults cannot certify runtime compatibility', () => {
  for (const value of [undefined, {}, { faults: 1, writeBit: 0, recovered: true },
    { faults: 0, writeBit: 1, recovered: true }, { faults: 2, writeBit: 1, recovered: true },
    { faults: 1, writeBit: 1, recovered: false }])
    assert.throws(() => validateHostFault(value), /incompatible/);
});
test('real host probe reports compatibility or the measured unsupported write fault', () => {
  try { const report = removalHostPreflight(); assert.equal(report.writeBit, 1); assert.equal(report.faults, 1); }
  catch (error) {
    assert.match(error.message, /write-fault metadata incompatible/);
    assert.equal(error.hostReport.writeBit, 0);
    assert.equal(error.hostReport.faults, 1);
    assert.equal(error.hostReport.recovered, true);
  }
});