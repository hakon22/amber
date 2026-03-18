import { Container, Singleton } from 'typescript-ioc';
import type { ExtraReplyMessage, ExtraEditMessageText } from 'telegraf/typings/telegram-types';
import type { Request, Response } from 'express';

import { UserEntity } from '@/db/entities/user.entity';
import { LoggerService } from '@/services/app/logger.service';
import { TelegramBotService } from '@/services/telegram/telegram-bot.service';

@Singleton
export class TelegramService {
  private readonly TAG = 'TelegramService';

  private readonly loggerService = Container.get(LoggerService);

  private readonly telegramBotService = Container.get(TelegramBotService);

  public handleWebhook = async (req: Request, res: Response) => {
    try {
      const bot = this.telegramBotService.getBot();
      await bot.handleUpdate(req.body);
      res.sendStatus(200);
    } catch (e) {
      this.loggerService.error(this.TAG, e);
      res.sendStatus(500);
    }
  };

  public start = async (telegramId: string) => {
    const user = await UserEntity.findOne({ where: { telegramId } });
    const name = user?.firstName || user?.username || 'друг';

    const message = [
      `Привет, ${name}! 👋`,
      'Я твой помощник по вопросам эксплуатации и обслуживания автомобиля.',
      '',
      'Что ты можешь сделать с помощью бота:',
      '• Задавать любые вопросы по обслуживанию и эксплуатации автомобиля.',
      '• Заполнить профиль автомобиля командой /profile, чтобы ответы учитывали марку, год и пробег.',
      '• Получать более точные рекомендации с учётом данных твоего авто.',
      '• Прервать долгий ответ: кнопка «Остановить» под спиннером или команда /stop.',
      '',
      'Просто напиши свой вопрос в чат, а чтобы настроить профиль — отправь команду /profile.',
    ];

    await this.sendMessage(message, telegramId);
  };

  public sendMessage = async (message: string | string[], telegramId: string, options?: ExtraReplyMessage) => {
    const text = this.serializeText(message);

    const result = await this.telegramBotService.sendMessage(text, telegramId, options);
    if (result?.message_id) {
      this.loggerService.info(this.TAG, `Сообщение в Telegram на telegramId ${telegramId} успешно отправлено`);
      return { ...result, text };
    }
  };

  public sendAdminMessages = async (message: string | string[], options?: ExtraReplyMessage) => {
    for (const tgId of [process.env.TELEGRAM_CHAT_ID, process.env.TELEGRAM_CHAT_ID2].filter(Boolean)) {
      const adminUser = await UserEntity.findOne({ select: ['id', 'telegramId'], where: { telegramId: tgId } });

      if (!adminUser?.telegramId) {
        continue;
      }

      await this.sendMessage(message, adminUser.telegramId, options);
    }
  };

  public editMessage = async (message: string | string[], telegramId: string, messageId: number, options?: ExtraEditMessageText) => {
    const text = this.serializeText(message);
    return this.telegramBotService.editMessage(text, telegramId, messageId, options);
  };

  private serializeText = (message: string | string[]) => Array.isArray(message) ? message.reduce((acc, field) => acc += `${field}\n`, '') : message;
}
