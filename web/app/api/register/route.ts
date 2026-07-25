import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const { email, password } = await req.json();

  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes('@')) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return NextResponse.json({ error: 'An account with that email already exists' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { email: normalizedEmail, passwordHash } });

  return NextResponse.json({ ok: true });
}
