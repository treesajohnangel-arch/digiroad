export type Detection = { label: string; confidence: number; box: [number, number, number, number] };

const CLASS_TABLE: Record<string, [string, string]> = {
  Pothole: ['Pothole', 'High'],
  'Alligator crack': ['Cracking', 'High'],
  'Longitudinal crack': ['Cracking', 'Medium'],
  'Transverse crack': ['Cracking', 'Medium'],
  'Surface deterioration': ['Surface damage', 'Low'],
};
const LEVELS = ['Low', 'Medium', 'High', 'Critical'];

/** Recommend the complaint form's category and severity from the model's detections; null when nothing was found.
 * Category and base severity come from the most confident detection; widespread damage raises severity one level. */
export function suggestFromDetections(
  found: Detection[],
  size: { width: number; height: number },
): { category: string; severity: string } | null {
  if (!found.length) return null;
  const top = found.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  const [category, base] = CLASS_TABLE[top.label] || ['Other', 'Medium'];
  const area = found.reduce((sum, d) => sum + Math.max(0, d.box[2] - d.box[0]) * Math.max(0, d.box[3] - d.box[1]), 0);
  // shortcut: the 15% area and 3-detection thresholds are a heuristic, not an engineering standard; tune with engineer input.
  const widespread = area >= 0.15 * size.width * size.height || found.length >= 3;
  const severity = LEVELS[Math.min(LEVELS.indexOf(base) + (widespread ? 1 : 0), LEVELS.length - 1)];
  return { category, severity };
}
