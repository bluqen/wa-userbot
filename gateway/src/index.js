import 'dotenv/config';
import dns from 'node:dns';
import express from 'express';
import cors from 'cors';

// Baileys 6 downloaded media through axios (Node's http/https stack, which
// does happy-eyeballs IPv4/IPv6 fallback). Baileys 7 uses native fetch --
// i.e. undici -- which does NOT fall back by default: if DNS returns an
// AAAA record first and the host can't actually route IPv6, every media
// download dies with a bare, causeless "fetch failed". That's exactly the
// symptom (100% of downloads, all media types, starting at the upgrade),
// while plain messaging over the websocket kept working.
//
// Preferring A records makes fetch behave like the old axios path did.
dns.setDefaultResultOrder('ipv4first');
import {
  startSession,
  sessionStatus,
  logoutSession,
  reconnectSession,
  listBlockedContacts,
  unblockContact,
  resetContactEncryption,
} from './whatsappManager.js';
import { fetchSessionsForGateway, describeFetchError } from './webClient.js';
import { isSessionRegistered } from './postgresAuthState.js';
import { startScheduler } from './scheduler.js';

// This process holds every paired session on this shard at once -- Baileys
// occasionally throws from deep inside its own internal retry/relay
// handling (e.g. servicing a decrypt-retry request against a socket that's
// already closing) in a way that never reaches any of our own try/catch
// blocks, since it originates inside the library's own event handling, not
// a call we make directly. Without a top-level safety net, that one
// session's hiccup crashes this entire process and disconnects every other
// paired session on the shard along with it. Log and keep running instead.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (gateway kept running):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (gateway kept running):', err);
});

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

// Every outbound call this gateway makes back to the web app (reconnect
// watchdog, scheduler, stickers) depends on WEB_APP_URL/INTERNAL_API_SECRET
// -- if either is missing or wrong on *this* service specifically, every one
// of those calls fails identically with a bare "fetch failed" and nothing
// upstream (AI Reply, pairing, admin dashboard) shows it, since none of
// those go through this path. Logged once at boot so a misconfigured env
// var here is visible immediately instead of only inferred from a string of
// unexplained fetch failures later.
console.log(
  `WEB_APP_URL=${process.env.WEB_APP_URL || '(unset, defaulting to http://localhost:3000 -- will not work on Render)'}`,
);
console.log(`INTERNAL_API_SECRET is ${process.env.INTERNAL_API_SECRET ? 'set' : 'NOT SET'}`);

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
    console.error(`[${userId}] failed to start session:`, err.message);
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
    console.error(`[${userId}] failed to reconnect session:`, err.message);
    res.status(500).json({ error: 'failed to reconnect session' });
  }
});

// A blocked contact silently swallows every message sent to them (the
// server acks it and returns an id, but never delivers), which looks
// exactly like the bot ignoring that one chat. These two let you see the
// account's blocklist and undo it without touching the phone.
app.get('/session/:userId/blocklist', async (req, res) => {
  try {
    res.json({ blocked: await listBlockedContacts(req.params.userId) });
  } catch (err) {
    console.error(`[${req.params.userId}] failed to list blocked contacts:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/session/:userId/unblock', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).json({ error: 'jid is required' });
  try {
    await unblockContact(req.params.userId, jid);
    res.json({ ok: true, blocked: await listBlockedContacts(req.params.userId) });
  } catch (err) {
    console.error(`[${req.params.userId}] failed to unblock ${jid}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Clears the stored encryption session for one contact so it renegotiates
// on the next message. For when sends to that contact come back with
// delivery status ERROR while the rest of the chat works -- see
// resetContactEncryption.
app.post('/session/:userId/reset-contact', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).json({ error: 'jid is required' });
  try {
    const cleared = await resetContactEncryption(req.params.userId, jid);
    res.json({ ok: true, cleared });
  } catch (err) {
    console.error(`[${req.params.userId}] failed to reset encryption for ${jid}:`, err.message);
    res.status(500).json({ error: err.message });
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
    console.error('Reconnect watchdog: failed to fetch known sessions:', describeFetchError(err));
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

  let skipped = 0;
  for (const s of sessions) {
    // A session only ever needs *reconnecting* if it actually finished
    // linking at some point (creds.registered). Baileys writes a `creds`
    // row almost immediately on socket creation -- long before a human has
    // entered a pairing code -- so a session someone started pairing and
    // then abandoned (or one WhatsApp has since force-logged-out) still
    // shows up here forever otherwise. Silently retrying those every 2
    // minutes does nothing useful and repeatedly hits WhatsApp's login
    // endpoint with automated, human-less connection attempts for the same
    // numbers -- exactly the pattern its anti-abuse system watches for, and
    // a plausible reason *new* pairing attempts from this same IP start
    // getting rejected too. Only a human explicitly re-pairing (the
    // /pair route) should attempt those.
    if (!(await isSessionRegistered(s.id))) {
      skipped += 1;
      continue;
    }
    reconnectSession(s.id, s.phoneNumber).catch((err) =>
      console.error(`[${s.id}] reconnect watchdog failed:`, err.message),
    );
  }
  if (skipped > 0) {
    console.log(
      `Reconnect watchdog: skipped ${skipped} session(s) that never finished pairing (left for a human /pair attempt)`,
    );
  }
}

app.listen(PORT, async () => {
  console.log(`WhatsApp gateway listening on http://localhost:${PORT}`);
  // Which code is actually running. Without this, "I deployed but nothing
  // changed" is indistinguishable from "the deploy didn't pick up the new
  // code" -- and telling those two apart by guesswork wastes a lot of time.
  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const baileysVersion = require('@whiskeysockets/baileys/package.json').version;
    console.log(`Build: node=${process.version} baileys=${baileysVersion}`);
  } catch (err) {
    console.error('Build: failed to read baileys version:', err.message);
  }
  reconnectKnownSessions();
  setInterval(reconnectKnownSessions, RECONNECT_WATCHDOG_INTERVAL_MS);
  startScheduler(PUBLIC_URL);
});
