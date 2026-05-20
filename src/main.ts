import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || isAllowedCorsOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`), false);
    },
    credentials: true
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true }
    })
  );

  const prismaService = app.get(PrismaService);
  await prismaService.enableShutdownHooks(app);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`RevSight API listening on port ${port}`);
}

void bootstrap();

function isAllowedCorsOrigin(origin: string): boolean {
  const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const allowedOrigins = new Set([
    'http://localhost:4200',
    'http://127.0.0.1:4200',
    'https://revsight.netlify.app',
    ...configuredOrigins
  ]);

  if (allowedOrigins.has(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.hostname.endsWith('.netlify.app');
  } catch {
    return false;
  }
}
