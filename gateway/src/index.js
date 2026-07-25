import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { startSession, sessionStatus, logoutSession, reconnectSession } from './whatsappManager.js';
import { fetchSessionsForGateway } from './webClient.js';
import { startScheduler } from './scheduler.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
// Must match exactly what's stored as this gateway's `gatewayUrl` on
// sessions (i.e. GATEWAY_URL / the shard URL registered for it) -- it's
// how the web app knows which sessions belong to *this* instance when
// asked "what was I holding before I restarted?".
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/session/:userId/pair', async (req, res) => {
  const { userId } = req.params;
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: 'phoneNumber is required' });
  }

  try {
    await startSession(userId, phoneNumber.replace(/\D/g, ''));
    res.json(sessionStatus(userId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to start session' });
  }
});

app.post('/session/:userId/reconnect', async (req, res) => {
  const { userId } = req.params;
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: 'phoneNumber is required' });
  }

  try {
    const result = await reconnectSession(userId, phoneNumber.replace(/\D/g, ''));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to reconnect session' });
  }
});

app.get('/session/:userId/status', (req, res) => {
  res.json(sessionStatus(req.params.userId));
});

app.post('/session/:userId/logout', async (req, res) => {
  await logoutSession(req.params.userId);
  res.json({ status: 'logged_out' });
});

// The in-memory session map starts empty every time this process starts --
// a Render redeploy, a crash, anything -- and nothing else automatically
// tells previously-live sessions to come back. Ask the web app what this
// instance used to be holding and reconnect each one; reconnectSession()
// already tries saved creds first and only needs a human if those no
// longer work (e.g. the device was actually unlinked from the phone).
//
// Doing this only once at startup isn't enough in practice -- a session
// can also die mid-lifetime for reasons the close-handler's own backoff
// doesn't cover cleanly (e.g. this exact process losing track of it
// without a clean 'close' event), and a single missed startup attempt
// (e.g. the web app not being reachable yet on a simultaneous deploy)
// would otherwise leave a session dead forever with nothing retrying it.
// So this also runs on an interval, not just once. reconnectSession()
// itself is already a safe no-op for anything already connected, so
// calling this repeatedly costs nothing for sessions that are fine.
const RECONNECT_WATCHDOG_INTERVAL_MS = 2 * 60 * 1000;

async function reconnectKnownSessions() {
  let sessions;
  try {
    sessions = await fetchSessionsForGateway(PUBLIC_URL);
  } catch (err) {
    console.error('Reconnect watchdog: failed to fetch known sessions:', err.message);
    return;
  }

  // Zero sessions here is indistinguishable from "everything's fine" unless
  // logged -- if PUBLIC_URL doesn't exactly match this shard's registered
  // url on the admin panel, this silently finds nothing to reconnect, every
  // single restart, forever. Log it so that failure mode is visible in
  // Render's logs instead of only showing up as "Unknown" on the dashboard.
  console.log(
    `Reconnect watchdog: found ${sessions.length} known session(s) for PUBLIC_URL=${PUBLIC_URL}`,
  );

  for (const s of sessions) {
    reconnectSession(s.id, s.phoneNumber).catch((err) =>
      console.error(`[${s.id}] reconnect watchdog failed:`, err.message),
    );
  }
}

app.listen(PORT, () => {
  console.log(`WhatsApp gateway listening on http://localhost:${PORT}`);
  reconnectKnownSessions();
  setInterval(reconnectKnownSessions, RECONNECT_WATCHDOG_INTERVAL_MS);
  startScheduler(PUBLIC_URL);
});
