import { Container } from 'typescript-ioc';
import type { Response } from 'express';

import { DatabaseService } from '@/db/database.service';
import { LoggerService } from '@/services/app/logger.service';
import { UserEntity } from '@/db/entities/user.entity';

export abstract class BaseService {
  protected databaseService = Container.get(DatabaseService);

  protected loggerService = Container.get(LoggerService);

  protected errorHandler = (e: any, res: Response, statusCode = 500) => {
    this.loggerService.error(e);

    let error = `${e?.name}: ${e?.message}`;

    if (e?.name === 'ValidationError') {
      error = `${e?.name}: "${e?.path}" ${e?.message}`;
    }

    if (e instanceof Error && e.stack && process.env.TELEGRAM_CHAT_ID && process.env.NODE_ENV === 'production') {
      UserEntity.findOne({ select: ['id'], where: { telegramId: process.env.TELEGRAM_CHAT_ID } })
        .then((adminUser) => {
          if (!adminUser) {
            return;
          }
          const message = [
            `Ошибка на сервере <b>${process.env.APP_NAME}</b>:`,
            `<pre><code class="language-typescript">${e.stack}</code></pre>`,
          ];
          this.loggerService.error(message);
        })
        .catch(this.loggerService.error);
    }

    res.status(statusCode).json({ error });
  };
}
