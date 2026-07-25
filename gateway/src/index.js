import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { startSession, sessionStatus, logoutSession, reconnectSession } from './whatsappManager.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

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

app.listen(PORT, () => {
  console.log(`WhatsApp gateway listening on http://localhost:${PORT}`);
});
