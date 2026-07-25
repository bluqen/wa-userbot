// Minimal, isolated pairing-code test -- no Express, no session manager,
// no retry hacks. Follows the official Baileys example pattern exactly:
// request the pairing code only after connection.update fires with `qr`.
//
// Usage: node scripts/basic-pair-test.mjs <phoneNumberDigitsOnly>

import pino from 'pino';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';

const phoneNumber = process.argv[2];
if (!phoneNumber) {
  console.error('Usage: node scripts/basic-pair-test.mjs <phoneNumberDigitsOnly>');
  process.exit(1);
}

const { state, saveCreds } = await useMultiFileAuthState('./scripts/.debug-auth');
const { version } = await fetchLatestBaileysVersion();

const sock = makeWASocket({
  version,
  auth: state,
  logger: pino({ level: 'debug' }),
  printQRInTerminal: false,
});

sock.ev.on('creds.update', saveCreds);

let pairingRequested = false;

sock.ev.on('connection.update', async (update) => {
  console.log('>>> connection.update', JSON.stringify(update));

  if (update.qr && !sock.authState.creds.registered && !pairingRequested) {
    pairingRequested = true;
    try {
      const code = await sock.requestPairingCode(phoneNumber);
      console.log('>>> PAIRING CODE:', code);
    } catch (err) {
      console.error('>>> requestPairingCode failed:', err);
    }
  }

  if (update.connection === 'open') {
    console.log('>>> CONNECTED SUCCESSFULLY');
    process.exit(0);
  }

  if (update.connection === 'close') {
    console.log(
      '>>> CONNECTION CLOSED:',
      JSON.stringify(update.lastDisconnect?.error?.output),
      JSON.stringify(update.lastDisconnect?.error?.data),
    );
    process.exit(1);
  }
});
