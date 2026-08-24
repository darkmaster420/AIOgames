// Only the two sources being migrated to the Python backend are exposed in the
// UI for now. The others are being retired as the strangler migration proceeds;
// re-add an entry here once its scraper is ported and wired.
export const SITES = [
  { value: 'skidrow', label: 'SkidRow' },
  { value: 'csrin', label: 'CS.RIN.RU' },
];

export const SITE_VALUES = SITES.map(s => s.value);
