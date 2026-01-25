import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS with more permissive settings
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:8080',
    'http://64.227.120.106:8080',
    'https://waw-beach-volley.site',
    'https://www.waw-beach-volley.site',
  ];

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, or same-origin requests)
      if (!origin) {
        return callback(null, true);
      }
      
      // Normalize origin (remove trailing slash)
      const normalizedOrigin = origin.replace(/\/$/, '');
      
      // Check if origin is in allowed list (exact match or normalized match)
      if (allowedOrigins.includes(origin) || allowedOrigins.includes(normalizedOrigin)) {
        callback(null, true);
      } else {
        // Log rejected origin for debugging
        console.log(`CORS blocked origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
    ],
    exposedHeaders: ['Content-Length', 'Content-Type'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400, // 24 hours
  });

  await app.listen(3000);
  console.log('Application is running on: http://localhost:3000');
  console.log('CORS enabled for origins:', allowedOrigins.join(', '));
}
bootstrap();
