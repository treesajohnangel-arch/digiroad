// Self-check for suggestFromDetections: node scripts/damageSuggest.check.ts
import assert from 'node:assert';
import { suggestFromDetections, type Detection } from '../src/damageSuggest.ts';

const size = { width: 1000, height: 1000 };
const det = (label: string, confidence: number, box: Detection['box'] = [0, 0, 100, 100]): Detection => ({ label, confidence, box });

assert.strictEqual(suggestFromDetections([], size), null);
assert.deepStrictEqual(suggestFromDetections([det('Pothole', 0.2)], size), { category: 'Pothole', severity: 'High' });
assert.deepStrictEqual(
  suggestFromDetections([det('Transverse crack', 0.3), det('Longitudinal crack', 0.2), det('Transverse crack', 0.1)], size),
  { category: 'Cracking', severity: 'High' }, // Medium bumped: 3 detections
);
assert.deepStrictEqual(
  suggestFromDetections([det('Surface deterioration', 0.4, [0, 0, 500, 400])], size), // 20% of the photo
  { category: 'Surface damage', severity: 'Medium' },
);
assert.deepStrictEqual(
  suggestFromDetections([det('Pothole', 0.1), det('Alligator crack', 0.5), det('Pothole', 0.2)], size),
  { category: 'Cracking', severity: 'Critical' }, // top is the alligator crack (High), bumped, capped at Critical
);
assert.deepStrictEqual(suggestFromDetections([det('Mystery', 0.5)], size), { category: 'Other', severity: 'Medium' });
console.log('damageSuggest ok');
