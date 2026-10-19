import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { planTrip, refreshEta, type TripRequest } from './planner.ts';
import { refreshSchema, tripSchema } from './schemas.ts';
import { GoogleProvider } from './providers/google.ts';
import { MockProvider } from './providers/mock.ts';
import { ProviderError, type MapsProvider } from './providers/types.ts';
import { hydrate, toStorable, type TripRepo } from './tripStore.ts';
import { SupabaseRepo, clientFor } from './supabaseRepo.ts';
import { z } from 'zod';

const useGoogle = process.env.MAPS_PROVIDER === 'google';
if (useGoogle && !process.env.GOOGLE_SERVER_API_KEY) throw new Error('MAPS_PROVIDER=google needs GOOGLE_SERVER_API_KEY');
const provider: MapsProvider = useGoogle
  ? new GoogleProvider(process.env.GOOGLE_SERVER_API_KEY!, Number(process.env.MAX_GOOGLE_CALLS_PER_DAY ?? 500))
  : new MockProvider();

const app = express();
app.use(express.json({ limit: '300kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 20), standardHeaders: true }));

app.get('/api/health', (_req, res) => res.json({ ok: true, provider: provider.source, live: provider.source === 'google' }));

app.post('/api/trips/generate', async (req, res, next) => {
  const p = tripSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Invalid trip details', issues: p.error.issues });
  try { res.json(await planTrip(p.data as TripRequest, provider)); } catch (e) { next(e); }
});

app.post('/api/trips/refresh', async (req, res, next) => {
  const p = refreshSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Invalid refresh request', issues: p.error.issues });
  try { res.json(await refreshEta(p.data, provider)); } catch (e) { next(e); }
});

// --- Saved trips (signed-in users, including Supabase anonymous users) ---
const auth: express.RequestHandler = async (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer /, '');
  if (!token) return res.status(401).json({ error: 'Sign-in required.' });
  try {
    const db = clientFor(token);
    const { data, error } = await db.auth.getUser(token); // verified by Supabase Auth, not just decoded
    if (error || !data.user) return res.status(401).json({ error: 'Session expired. Reopen the app and try again.' });
    res.locals.repo = new SupabaseRepo(db); next();
  } catch (e) { next(e); }
};
const repo = (res: express.Response) => res.locals.repo as TripRepo;
const idSchema = z.string().uuid();
const saveSchema = z.object({
  trip: z.object({ title: z.string().min(1).max(200), source: z.enum(['live', 'mock']), days: z.array(z.any()).max(14),
    req: z.object({ from: z.string(), to: z.string(), departure: z.string(), avoidTolls: z.boolean() }) }).passthrough(),
});

app.get('/api/saved', auth, async (_q, res, next) => { try { res.json(await repo(res).list()); } catch (e) { next(e); } });
app.post('/api/saved', auth, async (req, res, next) => {
  const p = saveSchema.safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Invalid trip', issues: p.error.issues });
  try { const t = p.data.trip; const row = await repo(res).create({ title: t.title, source: t.source, request: t.req, itinerary: toStorable(t) }); res.status(201).json({ id: row.id }); } catch (e) { next(e); }
});
app.get('/api/saved/:id', auth, async (req, res, next) => {
  if (!idSchema.safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid trip id' });
  try { const row = await repo(res).get(req.params.id); if (!row) return res.status(404).json({ error: 'Trip not found' }); res.json(await hydrate(row, provider)); } catch (e) { next(e); }
});
app.put('/api/saved/:id', auth, async (req, res, next) => {
  const p = saveSchema.safeParse(req.body); if (!p.success || !idSchema.safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid trip' });
  try { const row = await repo(res).update(req.params.id, { title: p.data.trip.title, itinerary: toStorable(p.data.trip) }); if (!row) return res.status(404).json({ error: 'Trip not found' }); res.json({ id: row.id }); } catch (e) { next(e); }
});
app.delete('/api/saved/:id', auth, async (req, res, next) => {
  if (!idSchema.safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid trip id' });
  try { (await repo(res).remove(req.params.id)) ? res.status(204).end() : res.status(404).json({ error: 'Trip not found' }); } catch (e) { next(e); }
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof ProviderError ? err.status : 500;
  console.error(JSON.stringify({ error: (err as Error).message, status })); // message only, no request bodies or keys
  res.status(status).json({ error: err instanceof ProviderError ? err.message : 'Unexpected server error' });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => console.log(`API on :${port} (provider: ${provider.source})`));
