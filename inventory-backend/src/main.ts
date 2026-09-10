import 'dotenv/config';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
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

async function bootstrap() {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error(
      'JWT_SECRET must be set to a strong value ' +
        '(at least 32 characters) in the backend .env file.',
    );
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Trust the load balancer / proxy hop (Render) so rate limiting keys each
  // client's real IP (via X-Forwarded-For) instead of lumping every device
  // into one shared bucket behind the proxy.
  app.set('trust proxy', 1);

  // Body parsers with a larger JSON limit so the AI product assistant can send
  // a base64 product photo (~1000px JPEG) in the request body. The default
  // 100kb Nest body limit is far too small for that payload.
  app.use(express.json({ limit: '3mb' }));
  app.use(express.urlencoded({ extended: true, limit: '3mb' }));

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

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
