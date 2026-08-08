import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Backs "!sm list". Returns a summary of this session's pending scheduled
// sends -- deliberately never their media.
//
// A scheduled photo carries its whole payload as base64 inside
// ScheduledTask.payload, so a plain findMany here would pull every queued
// file into memory just to print a numbered list. On a 512MB instance
// that's a real hazard (this project has already had OOM crash loops), so
// the fields needed for the list are extracted in SQL and the `data` key
// is never read at all.
const MAX_PENDING_LISTED = 50;
const PREVIEW_LENGTH = 80;

type PendingRow = {
  id: string;
  runAt: Date;
  jid: string | null;
  kind: string | null;
  mediaType: string | null;
  fileName: string | null;
  preview: string | null;
};

export async function GET(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  // `payload LIKE '{%'` guards the ::jsonb cast: one malformed row would
  // otherwise fail the whole query rather than just being skipped.
  const rows = await prisma.$queryRaw<PendingRow[]>`
    SELECT id,
           "runAt",
           payload::jsonb->>'jid' AS jid,
           payload::jsonb->>'kind' AS kind,
           payload::jsonb->>'mediaType' AS "mediaType",
           payload::jsonb->>'fileName' AS "fileName",
           left(coalesce(payload::jsonb->>'caption', payload::jsonb->>'text', ''), ${PREVIEW_LENGTH}) AS preview
    FROM "ScheduledTask"
    WHERE "sessionId" = ${sessionId}
      AND type = 'scheduled_send'
      AND "completedAt" IS NULL
      AND payload LIKE '{%'
    ORDER BY "runAt" ASC
    LIMIT ${MAX_PENDING_LISTED}
  `;

  return NextResponse.json({
    tasks: rows.map((row) => ({
      id: row.id,
      runAt: row.runAt instanceof Date ? row.runAt.toISOString() : String(row.runAt),
      jid: row.jid || '',
      kind: row.kind || 'text',
      mediaType: row.mediaType || null,
      fileName: row.fileName || null,
      preview: row.preview || '',
    })),
  });
}
