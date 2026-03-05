import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
// Используем прямой импорт без тестового кода из index.js
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mimeTypes from 'mime-types';
import { Singleton } from 'typescript-ioc';
import { createWorker } from 'tesseract.js';

import { FileEntity } from '@/db/entities/file.entity';

@Singleton
export class FileParserService {
  private readonly client: S3Client;

  private readonly bucket: string;

  constructor() {
    const region = process.env.YANDEX_S3_REGION ?? 'ru-central1';

    this.bucket = process.env.YANDEX_S3_BUCKET ?? '';

    this.client = new S3Client({
      region,
      endpoint: process.env.YANDEX_S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.YANDEX_S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.YANDEX_S3_SECRET_ACCESS_KEY ?? '',
      },
    });
  }

  public extractTextFromFile = async (file: FileEntity): Promise<string> => {
    const key = file.storageKey;
    const object = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));

    const buffer = await object.Body?.transformToByteArray();
    if (!buffer) {
      return '';
    }

    const mimeType = file.mime || mimeTypes.lookup(file.originalName) || '';

    if (mimeType === 'application/pdf') {
      const parsed = await pdfParse(Buffer.from(buffer));
      return parsed.text || '';
    }

    if (mimeType.startsWith('image/')) {
      const worker = await createWorker('eng+rus');
      try {
        const ret = await worker.recognize(Buffer.from(buffer));
        await worker.terminate();
        return ret.data.text || '';
      } catch {
        await worker.terminate();
        return '';
      }
    }

    if (mimeType.startsWith('video/')) {
      return '';
    }

    return Buffer.from(buffer).toString('utf8');
  };
}

