// Connects with the saved debug-auth creds (from basic-pair-test.mjs) just
// long enough to log out cleanly, so the linked-device entry on the test
// phone doesn't sit there indefinitely.
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState } from '@whiskeysockets/baileys';

const { state, saveCreds } = await useMultiFileAuthState('./scripts/.debug-auth');
const sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }) });
sock.ev.on('creds.update', saveCreds);

sock.ev.on('connection.update', async (update) => {
  if (update.connection === 'open') {
    console.log('connected, logging out...');
    await sock.logout().catch((err) => console.error('logout error:', err.message));
    console.log('done');
    process.exit(0);
  }
  if (update.connection === 'close') {
    console.log('closed before reaching open:', JSON.stringify(update.lastDisconnect?.error?.output));
    process.exit(1);
  }
});
