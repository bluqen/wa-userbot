import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/session';
import { gatewayPair, gatewayStatus } from '@/lib/gateway';
import { pickShardForNewSession } from '@/lib/shards';

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sessions = await prisma.waSession.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  const refreshed = await Promise.all(
    sessions.map(async (s) => {
      if (s.status === 'disconnected' || s.status === 'logged_out') return s;
      try {
        const live = await gatewayStatus(s.gatewayUrl, s.id);
        if (live.status !== s.status) {
          await prisma.waSession.update({ where: { id: s.id }, data: { status: live.status } });
          return { ...s, status: live.status };
        }
      } catch {
        // gateway unreachable -- fall back to last known status
      }
      return s;
    }),
  );

  return NextResponse.json({ sessions: refreshed });
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { label, phoneNumber } = await req.json();
  if (typeof phoneNumber !== 'string' || !phoneNumber.trim()) {
    return NextResponse.json({ error: 'phoneNumber is required' }, { status: 400 });
  }

  const digitsOnly = phoneNumber.replace(/\D/g, '');
  if (!digitsOnly) {
    return NextResponse.json({ error: 'phoneNumber must contain digits' }, { status: 400 });
  }

  // A given WhatsApp number can only hold one active Baileys connection at a
  // time -- pairing it into a second session concurrently corrupts the
  // Signal session for that device and produces "Waiting for this message"
  // for the account's contacts. Block it at creation time instead.
  const duplicate = await prisma.waSession.findFirst({
    where: { phoneNumber: digitsOnly, status: { not: 'disconnected' } },
  });
  if (duplicate) {
    return NextResponse.json(
      { error: 'This number is already paired in another session. Disconnect it first before adding it again.' },
      { status: 409 },
    );
  }

  const session = await prisma.waSession.create({
    data: {
      userId,
      label: typeof label === 'string' && label.trim() ? label.trim() : digitsOnly,
      phoneNumber: digitsOnly,
      status: 'connecting',
      gatewayUrl: await pickShardForNewSession(),
    },
  });

  try {
    const result = await gatewayPair(session.gatewayUrl, session.id, digitsOnly);
    await prisma.waSession.update({ where: { id: session.id }, data: { status: result.status } });
    return NextResponse.json({ session: { ...session, status: result.status }, pairingCode: result.pairingCode });
  } catch (err) {
    await prisma.waSession.delete({ where: { id: session.id } });
    return NextResponse.json({ error: 'Could not reach the WhatsApp gateway' }, { status: 502 });
  }
}
