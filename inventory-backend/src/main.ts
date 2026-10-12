import { config as loadEnv } from 'dotenv';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

// Load the backend .env even when the server is launched from the monorepo
// root (or a different cwd). `nest start --watch` does NOT reload .env on
// change, so after editing .env the backend must be restarted for new values
// to be picked up.
for (const envPath of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'inventory-backend/.env'),
  resolve(__dirname, '../../.env'),
  resolve(__dirname, '../.env'),
]) {
  loadEnv({ path: envPath });
}

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import proxyaddr from 'proxy-addr';
import { AppModule } from './app.module';
import { LocalizedExceptionFilter } from './common/filters/localized-exception.filter';
import { localeMiddleware } from './i18n/i18n.middleware';

const DEFAULT_CORS_ORIGINS = ['http://localhost:3001', 'http://localhost:3000'];

function resolveCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN;
  if (!raw) return DEFAULT_CORS_ORIGINS;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function writeBootFailure(error: unknown): void {
  const file = process.env.STATUS_FILE;
  if (!file) return;
  try {
    const message = error instanceof Error ? error.message : String(error);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify(
        {
          stage: 'backend',
          ok: false,
          error: message,
          time: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );
  } catch {
    // The status file must never mask the real boot failure.
  }
}

async function bootstrap() {
  const jwtSecret = process.env.JWT_SECRET;
  // 32 characters (~128 bits of hex) is the hard floor. The security hardening
  // recommends 64+, but enforcing that as a hard failure took prod down because
  // the owner cannot change the host env var. Warn loudly instead of crashing so
  // an existing 32+ char secret keeps working; rotate when convenient.
  if (!jwtSecret || jwtSecret.length < 32) {
    const message =
      'JWT_SECRET must be set to a strong random value of at least 32 ' +
      'characters (generate one with: openssl rand -hex 64).';
    writeBootFailure(new Error(message));
    throw new Error(message);
  }
  if (jwtSecret.length < 64) {
    console.warn(
      '[backend] JWT_SECRET is shorter than the recommended 64 characters; ' +
        'rotate it with `openssl rand -hex 64` when convenient.',
    );
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Only trust X-Forwarded-For when the deployment is actually behind a known
  // proxy AND the immediate peer matches a configured proxy hop. With the flag
  // off (default) Express ignores X-Forwarded-For entirely, so a direct client
  // cannot spoof its IP to evade login lockout or rate limits.
  const trustProxy = process.env.TRUST_PROXY === 'true';
  const trustedProxyCidrs = (
    process.env.TRUSTED_PROXY_CIDRS ?? 'loopback'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (trustProxy) {
    app.set('trust proxy', proxyaddr.compile(trustedProxyCidrs));
  }

  // Body parsers with a larger JSON limit so the AI assistants can send base64
  // photos (JPEG/PNG/HEIC) in the request body. HEIC files are passed through
  // without client-side downscaling, so allow up to the 15MB DTO cap.
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(cookieParser());

  // Resolve the request UI language (x-locale / Accept-Language) into the
  // AsyncLocalStorage context so guards, services and exception messages can
  // translate per request. Runs before guards because it is plain middleware.
  app.use(localeMiddleware);

  // Localize API error responses at the boundary: any English message that is
  // cataloged in backend.en.ts/backend.am.ts is re-rendered in the request
  // locale (x-locale / Accept-Language), covering guards, DTO/class-validator
  // messages and any not-yet-converted service throw sites.
  app.useGlobalFilters(new LocalizedExceptionFilter());

  app.enableCors({
    origin: resolveCorsOrigins(),
    credentials: true,
    maxAge: 86400,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Tenant-Id',
      'x-locale',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  const url = await app.getUrl();
  console.log(`[backend] listening on ${url} (PORT=${port})`);
}
bootstrap().catch((err) => {
  writeBootFailure(err);
  console.error('[backend] fatal boot error:', err);
  process.exit(1);
});
