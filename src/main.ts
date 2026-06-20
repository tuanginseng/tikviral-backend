import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';

async function bootstrap() {
  // Tắt built-in body parser của NestJS trước, sau đó dùng custom middleware
  // Nếu không tắt, NestJS sẽ reject request lớn TRƯỚC khi middleware bên dưới chạy
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Tăng giới hạn body size lên 500MB để nhận video base64 từ webhook GPU
  app.use(express.json({ 
    limit: '500mb',
    verify: (req: any, res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  }));
  app.use(express.urlencoded({ limit: '500mb', extended: true }));

  // Enable CORS
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
  console.log(`run port: 3000`);

}
bootstrap();
