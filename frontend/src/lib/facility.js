// How the hospital's "facility type" shapes the app: which menus are shown first or hidden,
// and which plan we recommend at sign-up. This is a convenience layout only — access is still
// decided on the server by plan + permissions, and the owner can change the type in Settings.

export const FACILITY_OPTIONS = [
  { value: 'clinic', label: 'Clinic' }, { value: 'hospital', label: 'Hospital' }, { value: 'multi_specialty', label: 'Multi-specialty hospital' },
  { value: 'diagnostic_centre', label: 'Diagnostic centre' }, { value: 'nursing_home', label: 'Nursing home' }, { value: 'other', label: 'Other' },
];

export const FACILITY_PROFILES = {
  clinic: {
    label: 'Clinic',
    hide: ['/app/admissions'],
    needs: [],
    note: 'Admissions & beds is hidden — clinics usually have no in-patient beds.',
  },
  diagnostic_centre: {
    label: 'Diagnostic centre',
    first: 'Laboratory',
    hide: ['/app/opd', '/app/admissions'],
    needs: ['laboratory', 'billing'],
    note: 'Laboratory is shown first; OPD and Admissions & beds are hidden.',
  },
  hospital: { label: 'Hospital', hide: [], needs: ['ipd', 'billing'], note: 'All modules are shown.' },
  multi_specialty: { label: 'Multi-specialty hospital', hide: [], needs: ['ipd', 'laboratory', 'pharmacy', 'billing'], note: 'All modules are shown.' },
  nursing_home: { label: 'Nursing home', hide: [], needs: ['ipd', 'billing'], note: 'All modules are shown.' },
  other: { label: 'Other', hide: [], needs: [], note: 'All modules are shown.' },
};

export const profileFor = (type) => FACILITY_PROFILES[type] || FACILITY_PROFILES.other;

/**
 * Re-arranges the sidebar for a facility type.
 * nav = [{ section }, { to, … }, …]  →  same shape, with hidden items removed and the
 * profile's preferred section moved right after "Overview".
 */
export function arrangeNav(nav, facilityType) {
  const p = profileFor(facilityType);
  const groups = [];
  for (const item of nav) {
    if (item.section) groups.push({ head: item, items: [] });
    else if (!p.hide.includes(item.to)) groups[groups.length - 1]?.items.push(item);
  }
  if (p.first) {
    const i = groups.findIndex((g) => g.head.section === p.first);
    if (i > 1) groups.splice(1, 0, ...groups.splice(i, 1));
  }
  return groups.flatMap((g) => (g.items.length ? [g.head, ...g.items] : []));
}

/**
 * Suggests the cheapest online plan that includes every module this facility type needs,
 * when the chosen plan is missing some. Returns null when the chosen plan is fine.
 */
export function planSuggestion(plans, chosen, facilityType) {
  if (!plans || !chosen) return null;
  const needs = profileFor(facilityType).needs;
  const has = (plan, key) => plan.features?.some((f) => f.key === key && f.included);
  const missing = needs.filter((k) => !has(chosen, k));
  if (!missing.length) return null;
  const better = plans
    .filter((p) => !p.contactSales && needs.every((k) => has(p, k)))
    .sort((a, b) => Number(a.monthly?.subtotal ?? 0) - Number(b.monthly?.subtotal ?? 0))[0];
  const labels = missing.map((k) => chosen.features?.find((f) => f.key === k)?.label || k);
  return { missing: labels, plan: better || null };
}
