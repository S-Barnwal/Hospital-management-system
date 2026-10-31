// Public, read-only lists of countries → states → cities for the address dropdowns on every screen.
// Static data from the server's memory: no database, no tenant data, safe to cache in the browser.
import { Router } from 'express';
import { asyncHandler, badRequest } from '../../utils/errors.js';
import { loadGeo, flagOf } from '../../utils/geo.js';

const router = Router();
const ISO2 = /^[A-Z]{2}$/;
const STATE_CODE = /^[A-Z0-9]{1,5}$/;
const cache = (res) => res.set('Cache-Control', 'public, max-age=86400');

let countriesCache = null;
router.get('/countries', asyncHandler(async (_req, res) => {
  const g = await loadGeo();
  countriesCache ??= g.Country.getAllCountries()
    .map((c) => ({ code: c.isoCode, name: c.name, flag: flagOf(c.isoCode) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  cache(res).json({ data: countriesCache });
}));

router.get('/states', asyncHandler(async (req, res) => {
  const country = String(req.query.country || '').toUpperCase();
  if (!ISO2.test(country)) throw badRequest('Choose a country.');
  const g = await loadGeo();
  const states = g.State.getStatesOfCountry(country).map((s) => ({ code: s.isoCode, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  cache(res).json({ data: states });
}));

router.get('/cities', asyncHandler(async (req, res) => {
  const country = String(req.query.country || '').toUpperCase();
  const state = String(req.query.state || '').toUpperCase();
  if (!ISO2.test(country) || !STATE_CODE.test(state)) throw badRequest('Choose a country and state.');
  const g = await loadGeo();
  const names = [...new Set(g.City.getCitiesOfState(country, state).map((c) => c.name))].sort((a, b) => a.localeCompare(b));
  cache(res).json({ data: names });
}));

export default router;
