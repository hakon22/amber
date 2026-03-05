import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { Singleton } from 'typescript-ioc';

@Singleton
export class FileStorageService {
  private readonly client: S3Client;

  private readonly bucket: string;

  private readonly publicEndpoint?: string;

  constructor() {
    this.bucket = process.env.YANDEX_S3_BUCKET ?? '';
    this.publicEndpoint = process.env.YANDEX_S3_PUBLIC_ENDPOINT;

    this.client = new S3Client({
      region: 'ru-central1',
      endpoint: process.env.YANDEX_S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.YANDEX_S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.YANDEX_S3_SECRET_ACCESS_KEY ?? '',
        accountId: process.env.YANDEX_S3_ACCOUNT_ID ?? '',
      },
    });
  }

  public uploadBuffer = async (key: string, buffer: Buffer, mime: string): Promise<void> => {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: mime,
    }));
  };

  public deleteObject = async (key: string): Promise<void> => {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  };

  /** Скачивает объект из S3 и возвращает его содержимое. */
  public getBuffer = async (key: string): Promise<Buffer> => {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) {
      throw new Error(`Empty body for key: ${key}`);
    }
    return Buffer.from(bytes);
  };

  public getPublicUrl = (key: string): string | null => {
    if (this.publicEndpoint) {
      return `${this.publicEndpoint.replace(/\/$/, '')}/${key}`;
    }
    return null;
  };

  public checkHealth = async (): Promise<void> => {
    await this.client.send(new HeadBucketCommand({
      Bucket: this.bucket,
    }));
  };
}

