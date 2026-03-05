import { Container, Singleton } from 'typescript-ioc';
import type { Router } from 'express';

import { BaseRouter } from '@/routes/base.route';
import { DatabaseService } from '@/db/database.service';
import { FileStorageService } from '@/services/file/file-storage.service';
import { TelegramBotService } from '@/services/telegram/telegram-bot.service';

@Singleton
export class HealthRoute extends BaseRouter {
  private readonly databaseService = Container.get(DatabaseService);

  private readonly fileStorageService = Container.get(FileStorageService);

  private readonly telegramBotService = Container.get(TelegramBotService);

  public set = (router: Router) => {
    router.get('/health', async (req, res) => {
      const dbStatus = await this.checkDb();
      const s3Status = await this.checkS3();
      const telegramStatus = await this.checkTelegram();

      const allOk = dbStatus.ok && s3Status.ok && telegramStatus.ok;

      res.status(allOk ? 200 : 503).json({
        status: allOk ? 'ok' : 'degraded',
        db: dbStatus,
        s3: s3Status,
        telegram: telegramStatus,
      });
    });
  };

  private checkDb = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const manager = this.databaseService.getManager();
      await manager.query('SELECT 1');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'DB error' };
    }
  };

  private checkS3 = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      await this.fileStorageService.checkHealth();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'S3 error' };
    }
  };

  private checkTelegram = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const bot = this.telegramBotService.getBot();
      await bot.telegram.getMe();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Telegram error' };
    }
  };
}

