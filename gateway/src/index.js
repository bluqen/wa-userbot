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
async function reconnectKnownSessions() {
  let sessions;
  try {
    sessions = await fetchSessionsForGateway(PUBLIC_URL);
  } catch (err) {
    console.error('Startup reconnect: failed to fetch known sessions:', err.message);
    return;
  }

  console.log(`Startup reconnect: found ${sessions.length} session(s) to restore`);
  for (const s of sessions) {
    reconnectSession(s.id, s.phoneNumber).catch((err) =>
      console.error(`[${s.id}] startup reconnect failed:`, err.message),
    );
  }
}

app.listen(PORT, () => {
  console.log(`WhatsApp gateway listening on http://localhost:${PORT}`);
  reconnectKnownSessions();
  startScheduler(PUBLIC_URL);
});
