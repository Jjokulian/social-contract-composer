// Example demesnes for the Globe, shown on Earth while it has none of its own. They are not in the catalogue and their
// millis don't exist: they only show how demesnes nest. A defensive military demesne is segmented exhaustively into
// four cultural demesnes; within those lie islands of others, and within one island, another.
// Each is in force over a period, one quarter ends and another comes after it: set an instant on the Globe
// (?when=1880, ?when=1900), or drag along the Timeline, to see what was in force then.
// Placed in the open Atlantic, so no real place is implied.

// An irregular island around a centre, as a closed ring.
const island = (cx, cy, r, seed) => {
  const ring = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * 2 * Math.PI, k = 0.8 + 0.2 * Math.sin(3 * a + seed);
    return [+(cx + r * k * Math.cos(a)).toFixed(4), +(cy + r * k * Math.sin(a)).toFixed(4)];
  });
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
};
const polygon = ring => ({ type: 'Polygon', coordinates: [[...ring, ring[0]]] });

// The two borders that segment the shield, meeting at [-44.4, 32].
const west = [[-50, 32], [-48, 32.6], [-46, 31.5], [-44.4, 32]];
const east = [[-44.4, 32], [-42, 32.7], [-40, 31.6], [-38, 32]];
const north = [[-44.4, 32], [-43.5, 33.5], [-44.6, 35], [-44, 36]];
const south = [[-44, 28], [-44.8, 29.5], [-43.6, 31], [-44.4, 32]];
const rev = line => [...line].reverse();

const demesne = (id, name, milliId, milliTitle, segment, period = {}) => ({
  id: `example-${id}`, rev: 1, ref: `example-${id}@1`, name, space: 'earth', segment, example: true,
  milli: `example-${milliId}@1`, milliTitle, filedBy: 'example', source: 'example', ...period,
});

export const EXAMPLE = [
  demesne('shield', 'The shield', 'defence', 'Defensive military milli', polygon([[-50, 28], [-38, 28], [-38, 36], [-50, 36]]), { from: '1815' }),
  demesne('north-west', 'North-west country', 'hearth', 'Hearth culture', polygon([...west, ...north.slice(1), [-50, 36]]), { from: '1820' }),
  demesne('north-east', 'North-east country', 'seafaring', 'Seafaring culture', polygon([...east, [-38, 36], ...rev(north).slice(0, -1)]), { from: '1820' }),
  demesne('south-west', 'South-west country', 'hill', 'Hill culture', polygon([[-50, 28], ...south, ...rev(west).slice(1)]), { from: '1832' }),
  demesne('south-east', 'South-east country', 'river', 'River culture', polygon([[-44, 28], [-38, 28], ...rev(east), ...rev(south).slice(1, -1)]), { from: '1832' }),
  demesne('quiet-quarter', 'Quiet quarter', 'quiet', 'Quiet atmosphere', island(-47.5, 34.2, 0.9, 0.3), { from: '1848' }),
  demesne('silent-garden', 'Silent garden', 'silence', 'Silence', island(-47.5, 34.2, 0.3, 1.1), { from: '1861' }),
  demesne('craft-quarter', 'Craft guild quarter', 'guild', 'Guild conduct', island(-45.9, 35.1, 0.45, 2.0), { from: '1840', until: '1890' }),
  // The works quarter came after the craft quarter: another demesne, on another segment, under another milli, whose
  // deme signed afresh. Succession is never continuity, so nothing carries over but the record of what followed what.
  demesne('works-quarter', 'Works quarter', 'works', 'Works conduct', island(-44.9, 35.3, 0.4, 1.2),
          { from: '1890', after: 'example-craft-quarter@1' }),
  demesne('harbour-quarter', 'Harbour quarter', 'guild', 'Guild conduct', island(-42.6, 33.8, 0.45, 0.7), { from: '1855' }),
  demesne('festival-grounds', 'Festival grounds', 'festive', 'Festive atmosphere', island(-40.3, 34.4, 0.8, 1.6), { from: '1869', until: '1902' }),
  demesne('scholars-quarter', 'Scholars’ quarter', 'quiet', 'Quiet atmosphere', island(-47.2, 30.0, 0.8, 2.4), { from: '1873' }),
  demesne('market-quarter', 'Market quarter', 'festive', 'Festive atmosphere', island(-41.0, 29.8, 0.7, 0.2), { from: '1902' }),
];
