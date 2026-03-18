import { Container, Singleton } from 'typescript-ioc';
import { In } from 'typeorm';
import axios from 'axios';
import { Markup, type Telegraf, type Context } from 'telegraf';

import { TelegramBotService } from '@/services/telegram/telegram-bot.service';
import { TelegramService } from '@/services/telegram/telegram.service';
import { KnowledgeBaseCrudService } from '@/services/knowledge-base/knowledge-base-crud.service';
import { FileStorageService } from '@/services/file/file-storage.service';
import { FileParserService } from '@/services/file/file-parser.service';
import { FileEntity } from '@/db/entities/file.entity';
import { KnowledgeBaseEntity } from '@/db/entities/knowledge-base.entity';
import { TelegramDialogStateEntity, TelegramDialogStateEnum } from '@/db/entities/telegram-dialog-state.entity';
import { SupportAgentOrchestratorService } from '@/services/model/support-orchestrator.service';
import { UserEntity } from '@/db/entities/user.entity';
import { ResponseHistoryEntity, type ResponseRating } from '@/db/entities/response-history.entity';
import { BaseService } from '@/services/app/base.service';
import { YandexVoiceRecognitionService } from '@/services/voice/yandex-voice-recognition.service';

const DOTS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

@Singleton
export class TelegramBotCommandService extends BaseService {
  private readonly telegramBotService = Container.get(TelegramBotService);

  private readonly telegramService = Container.get(TelegramService);

  private readonly knowledgeBaseCrudService = Container.get(KnowledgeBaseCrudService);

  private readonly fileStorageService = Container.get(FileStorageService);

  private readonly supportOrchestratorService = Container.get(SupportAgentOrchestratorService);

  private readonly fileParserService = Container.get(FileParserService);

  private readonly yandexVoiceRecognitionService = Container.get(YandexVoiceRecognitionService);

  private readonly MAX_ERROR_MESSAGE_LENGTH = 4000;

  private readonly ADMIN_UPLOAD_COMMAND = '📤 Загрузить информацию';

  private readonly ADMIN_FINISH_FILES_COMMAND = '✅ Готово';

  private readonly ADMIN_RESET_COMMAND = '🔄 Сбросить';

  private readonly ADMIN_SKIP_TEXT_COMMAND = 'Текст не нужен, у меня файлы';

  private readonly CANCEL_COMMAND = '❌ Отмена';

  private readonly PROFILE_COMMAND = '/profile';

  private readonly TAG = 'TelegramBotCommandService';

  /** telegramId → отмена текущего ответа поддержки */
  private readonly cancelAnswerByTelegramId = new Map<string, () => void>();

  private readonly CANCELLED_ANSWER_MESSAGE = '⛔ Ответ остановлен.';

  public register = (bot: Telegraf<Context>): void => {
    bot.start(async (ctx) => {
      const telegramId = ctx.from.id.toString();

      const user = await this.ensureUser(ctx);
      await this.telegramService.start(telegramId);

      if (this.isAdmin(user)) {
        await this.telegramService.sendMessage(
          ['Режим администратора.', 'Для загрузки знаний в базу нажмите кнопку ниже.'],
          telegramId,
          { reply_markup: this.getAdminMainKeyboard().reply_markup },
        );
      }
    });

    bot.command('stop', async (ctx) => {
      const telegramId = ctx.from?.id?.toString();
      if (!telegramId) {
        return;
      }
      const cancelAnswer = this.cancelAnswerByTelegramId.get(telegramId);
      if (cancelAnswer) {
        cancelAnswer();
      } else {
        await this.telegramService.sendMessage('Нет активного ответа для остановки.', telegramId);
      }
    });

    bot.on('text', async (ctx) => {
      const telegramId = ctx.from.id.toString();
      const text = ctx.message.text ?? '';
      const trimmed = text.trim();

      try {
        const user = await this.ensureUser(ctx);
        const state = await this.getOrCreateState(telegramId);

        if (state.state !== TelegramDialogStateEnum.IDLE && trimmed === this.CANCEL_COMMAND) {
          await this.setState(telegramId, TelegramDialogStateEnum.IDLE, {});
          const replyMarkup = this.isAdmin(user)
            ? this.getAdminMainKeyboard().reply_markup
            : Markup.removeKeyboard().reply_markup;
          await this.telegramService.sendMessage('Действие отменено.', telegramId, { reply_markup: replyMarkup });
          return;
        }

        if (trimmed === this.PROFILE_COMMAND) {
          await this.setState(telegramId, TelegramDialogStateEnum.PROFILE_WAIT_MODEL, {});
          await this.telegramService.sendMessage(
            'Введите модель автомобиля (например, Амберавто А5):',
            telegramId,
            { reply_markup: this.getCancelKeyboard().reply_markup },
          );
          return;
        }

        if (this.isAdmin(user)) {
          const handledByAdminFlow = await this.handleAdminText(user, text);
          if (handledByAdminFlow) {
            return;
          }
        }

        const handledProfile = await this.handleProfileText(user, text);
        if (handledProfile) {
          return;
        }

        this.scheduleSupportAnswerWithSpinner(user.telegramId, () =>
          this.supportOrchestratorService.answerUserQuestion(user.telegramId, text),
        );
      } catch (err) {
        await this.sendErrorToUser(telegramId, err);
      }
    });

    bot.on('document', async (ctx) => {
      const user = await this.ensureUser(ctx);
      const state = await this.getOrCreateState(user.telegramId);

      const document = ctx.message.document;
      if (!document) {
        return;
      }

      const fileId = document.file_id;
      const fileName = document.file_name ?? 'document';
      const mimeType = document.mime_type ?? 'application/octet-stream';
      const caption = ctx.message.caption ?? '';

      if (this.isAdmin(user) && state.state === TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_FILES) {
        const data = state.data || {};
        const pendingFileCount = (data.pendingFileCount ?? 0) + 1;
        state.data = { ...data, pendingFileCount };
        await state.save();

        await this.telegramService.sendMessage(
          `Обрабатываю файл "${fileName}"… (крупные файлы могут занять минуту). Кнопка «Готово» появится после загрузки.`,
          user.telegramId,
          { reply_markup: this.getAdminFilesStepKeyboardWithoutDone().reply_markup },
        );

        this.processDocumentInBackground(fileId, fileName, mimeType, user).catch((err) => {
          this.decrementPendingFileCountAndUpdateKeyboard(user.telegramId);
          const wrapped = err instanceof Error
            ? Object.assign(new Error(`Ошибка при сохранении файла "${fileName}": ${err.message}`), { stack: err.stack })
            : new Error(`Ошибка при сохранении файла "${fileName}": ${String(err)}`);
          return this.sendErrorToUser(user.telegramId, wrapped);
        });
        return;
      }

      await this.handleUserFileQuestion(user, {
        fileId,
        fileName,
        mimeType,
        caption,
      });
    });

    bot.on('photo', async (ctx) => {
      const user = await this.ensureUser(ctx);
      const state = await this.getOrCreateState(user.telegramId);

      const photos = ctx.message.photo;
      if (!photos?.length) {
        return;
      }

      const largestPhoto = photos[photos.length - 1];
      const fileId = largestPhoto.file_id;
      const fileName = `photo_${largestPhoto.file_unique_id}.jpg`;
      const mimeType = 'image/jpeg';
      const caption = ctx.message.caption ?? '';

      if (this.isAdmin(user) && state.state === TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_FILES) {
        const data = state.data || {};
        const pendingFileCount = (data.pendingFileCount ?? 0) + 1;
        state.data = { ...data, pendingFileCount };
        await state.save();

        await this.telegramService.sendMessage(
          'Обрабатываю фото… Кнопка «Готово» появится после загрузки.',
          user.telegramId,
          { reply_markup: this.getAdminFilesStepKeyboardWithoutDone().reply_markup },
        );

        this.processPhotoInBackground(fileId, fileName, user).catch((err) => {
          this.decrementPendingFileCountAndUpdateKeyboard(user.telegramId);
          const wrapped = err instanceof Error
            ? Object.assign(new Error(`Ошибка при сохранении фото: ${err.message}`), { stack: err.stack })
            : new Error(`Ошибка при сохранении фото: ${String(err)}`);
          return this.sendErrorToUser(user.telegramId, wrapped);
        });
        return;
      }

      await this.handleUserFileQuestion(user, {
        fileId,
        fileName,
        mimeType,
        caption,
      });
    });

    bot.on('video', async (ctx) => {
      const user = await this.ensureUser(ctx);
      const state = await this.getOrCreateState(user.telegramId);

      const video = ctx.message.video;
      if (!video) {
        return;
      }

      const fileId = video.file_id;
      const fileName = video.file_name ?? `video_${video.file_unique_id}.mp4`;
      const mimeType = video.mime_type ?? 'video/mp4';
      const caption = ctx.message.caption ?? '';

      if (this.isAdmin(user) && state.state === TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_FILES) {
        const data = state.data || {};
        const pendingFileCount = (data.pendingFileCount ?? 0) + 1;
        state.data = { ...data, pendingFileCount };
        await state.save();

        await this.telegramService.sendMessage(
          `Обрабатываю видео "${fileName}"… Кнопка «Готово» появится после загрузки.`,
          user.telegramId,
          { reply_markup: this.getAdminFilesStepKeyboardWithoutDone().reply_markup },
        );

        this.processDocumentInBackground(fileId, fileName, mimeType, user).catch((err) => {
          this.decrementPendingFileCountAndUpdateKeyboard(user.telegramId);
          const wrapped = err instanceof Error
            ? Object.assign(new Error(`Ошибка при сохранении видео "${fileName}": ${err.message}`), { stack: err.stack })
            : new Error(`Ошибка при сохранении видео "${fileName}": ${String(err)}`);
          return this.sendErrorToUser(user.telegramId, wrapped);
        });
        return;
      }

      await this.handleUserFileQuestion(user, {
        fileId,
        fileName,
        mimeType,
        caption,
      });
    });

    bot.on('video_note', async (ctx) => {
      const user = await this.ensureUser(ctx);
      const state = await this.getOrCreateState(user.telegramId);

      const videoNote = ctx.message.video_note;
      if (!videoNote) {
        return;
      }

      const fileId = videoNote.file_id;
      const fileName = `video_note_${videoNote.file_unique_id}.mp4`;
      const mimeType = 'video/mp4';
      const caption = typeof ctx.message === 'object' && 'caption' in ctx.message && typeof ctx.message.caption === 'string'
        ? ctx.message.caption
        : '';

      if (this.isAdmin(user) && state.state === TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_FILES) {
        const data = state.data || {};
        const pendingFileCount = (data.pendingFileCount ?? 0) + 1;
        state.data = { ...data, pendingFileCount };
        await state.save();

        await this.telegramService.sendMessage(
          'Обрабатываю видеосообщение… Кнопка «Готово» появится после загрузки.',
          user.telegramId,
          { reply_markup: this.getAdminFilesStepKeyboardWithoutDone().reply_markup },
        );

        this.processDocumentInBackground(fileId, fileName, mimeType, user).catch((err) => {
          this.decrementPendingFileCountAndUpdateKeyboard(user.telegramId);
          const wrapped = err instanceof Error
            ? Object.assign(new Error(`Ошибка при сохранении видеосообщения: ${err.message}`), { stack: err.stack })
            : new Error(`Ошибка при сохранении видеосообщения: ${String(err)}`);
          return this.sendErrorToUser(user.telegramId, wrapped);
        });
        return;
      }

      await this.handleUserFileQuestion(user, {
        fileId,
        fileName,
        mimeType,
        caption,
      });
    });

    bot.on('voice', async (ctx) => {
      const user = await this.ensureUser(ctx);
      const state = await this.getOrCreateState(user.telegramId);

      const voice = ctx.message.voice;
      if (!voice) {
        return;
      }

      const fileId = voice.file_id;
      const fileName = `voice_${voice.file_unique_id}.ogg`;
      const mimeType = 'audio/ogg';

      if (this.isAdmin(user) && state.state === TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_FILES) {
        const data = state.data || {};
        const pendingFileCount = (data.pendingFileCount ?? 0) + 1;
        state.data = { ...data, pendingFileCount };
        await state.save();

        await this.telegramService.sendMessage(
          'Обрабатываю голосовое сообщение… Кнопка «Готово» появится после загрузки.',
          user.telegramId,
          { reply_markup: this.getAdminFilesStepKeyboardWithoutDone().reply_markup },
        );

        this.processDocumentInBackground(fileId, fileName, mimeType, user).catch((err) => {
          this.decrementPendingFileCountAndUpdateKeyboard(user.telegramId);
          const wrapped = err instanceof Error
            ? Object.assign(new Error(`Ошибка при сохранении голосового сообщения: ${err.message}`), { stack: err.stack })
            : new Error(`Ошибка при сохранении голосового сообщения: ${String(err)}`);
          return this.sendErrorToUser(user.telegramId, wrapped);
        });
        return;
      }

      try {
        const telegram = this.telegramBotService.getBot().telegram;
        const buffer = await this.downloadTelegramFileAsBuffer(telegram, fileId);
        const transcription = await this.yandexVoiceRecognitionService.transcribeShortAudio(buffer);

        if (!transcription.trim()) {
          await this.telegramService.sendMessage(
            'Не удалось распознать текст из голосового сообщения. Попробуйте ещё раз или отправьте текст.',
            user.telegramId,
          );
          return;
        }

        this.scheduleSupportAnswerWithSpinner(user.telegramId, () =>
          this.supportOrchestratorService.answerUserQuestion(user.telegramId, transcription),
        );
      } catch (err) {
        if (err instanceof Error && err.message.includes('too large')) {
          await this.telegramService.sendMessage(
            'Голосовое сообщение слишком большое для распознавания. Попробуйте прислать более короткое голосовое или отправьте текст.',
            user.telegramId,
          );
          return;
        }

        await this.sendErrorToUser(user.telegramId, 'Ошибка при распознавании голосового сообщения. Сообщение не должно превышать 30 секунд.');
      }
    });

    bot.on('callback_query', async (ctx) => {
      const user = await this.ensureUser(ctx);

      const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data ?? '' : '';

      if (data.startsWith('stop:')) {
        const targetTelegramId = data.slice('stop:'.length);
        await ctx.answerCbQuery();
        const cancelAnswer = this.cancelAnswerByTelegramId.get(targetTelegramId);
        if (cancelAnswer) {
          cancelAnswer();
        } else {
          await this.telegramService.sendMessage('Задача уже завершена или не найдена.', user.telegramId);
        }
        return;
      }

      if (!data.startsWith('fb:')) {
        await ctx.answerCbQuery();
        return;
      }

      const [, historyIdStr, ratingStr] = data.split(':');
      const historyId = Number.parseInt(historyIdStr, 10);
      const rating = ratingStr as ResponseRating;

      if (!historyId || (rating !== 'USEFUL' && rating !== 'NOT_USEFUL')) {
        await ctx.answerCbQuery('Некорректные данные обратной связи');
        return;
      }

      const history = await ResponseHistoryEntity.findOne({ where: { id: historyId } });
      if (!history) {
        await ctx.answerCbQuery('Ответ не найден');
        return;
      }

      history.rating = rating;
      await history.save();

      await ctx.answerCbQuery('Спасибо за вашу оценку!');

      // Убираем кнопки с исходного сообщения после оценки
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch (e) {
        this.loggerService.error(this.TAG, 'Failed to edit message reply markup', e);
      }

      if (rating === 'NOT_USEFUL') {
        await this.setState(user.telegramId, TelegramDialogStateEnum.FEEDBACK_WAIT_CORRECTION, { historyId });
        await this.telegramService.sendMessage(
          'Пожалуйста, напишите, как бы вы скорректировали или дополнили ответ, чтобы он был полезным.',
          user.telegramId,
          { reply_markup: this.getCancelKeyboard().reply_markup },
        );
      }
    });

    bot.catch((err: unknown, ctx) => {
      this.loggerService.error(this.TAG, 'Unhandled error in bot handler', err);
      const telegramId = ctx.chat?.id?.toString();
      if (telegramId) {
        this.sendErrorToUser(telegramId, err).catch((sendErr) => {
          this.loggerService.error(this.TAG, 'Failed to send error to user', sendErr);
        });
      }
    });
  };

  private getAdminMainKeyboard = () =>
    Markup.keyboard([[this.ADMIN_UPLOAD_COMMAND]]).resize(true).persistent();

  private getCancelKeyboard = () =>
    Markup.keyboard([[this.CANCEL_COMMAND]]).resize(true).oneTime(true);

  private getAdminStepResetKeyboard = () =>
    Markup.keyboard([[this.ADMIN_RESET_COMMAND, this.CANCEL_COMMAND]]).resize(true).persistent();

  private getAdminTextStepKeyboard = () =>
    Markup.keyboard([[this.ADMIN_SKIP_TEXT_COMMAND], [this.ADMIN_RESET_COMMAND, this.CANCEL_COMMAND]]).resize(true).persistent();

  private getAdminFilesStepKeyboard = () =>
    Markup.keyboard([[this.ADMIN_FINISH_FILES_COMMAND], [this.ADMIN_RESET_COMMAND, this.CANCEL_COMMAND]]).resize(true).persistent();

  /** Клавиатура шага файлов без «Готово» — показывается, пока идёт обработка файлов */
  private getAdminFilesStepKeyboardWithoutDone = () =>
    Markup.keyboard([[this.ADMIN_RESET_COMMAND, this.CANCEL_COMMAND]]).resize(true).persistent();

  /** Подпись текущего шага процесса загрузки в базу знаний */
  private getUploadStepLabel = (step: 1 | 2 | 3): string => {
    const labels: Record<1 | 2 | 3, string> = {
      1: 'Загрузка в базу знаний · Шаг 1/3: заголовок',
      2: 'Загрузка в базу знаний · Шаг 2/3: текст',
      3: 'Загрузка в базу знаний · Шаг 3/3: файлы',
    };
    return labels[step];
  };

  private formatUploadStepMessage = (step: 1 | 2 | 3, text: string): string =>
    `${this.getUploadStepLabel(step)}\n\n${text}`;

  private escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  private formatErrorForChat = (err: unknown): string => {
    const message = err instanceof Error ? err.message : String(err);
    const rawStack = err instanceof Error && err.stack ? err.stack.trim() : '';
    const msgPart = `⚠️ Ошибка: <b>${this.escapeHtml(message)}</b>`;
    if (!rawStack) {
      return msgPart.length <= this.MAX_ERROR_MESSAGE_LENGTH ? msgPart : msgPart.slice(0, this.MAX_ERROR_MESSAGE_LENGTH - 10) + '…';
    }
    const prefix = `${msgPart}\n\n`;
    const codeWrap = '<pre><code>';
    const codeWrapEnd = '</code></pre>';
    const maxBlockLength = this.MAX_ERROR_MESSAGE_LENGTH - prefix.length - codeWrap.length - codeWrapEnd.length;
    const stackEscaped = this.escapeHtml(rawStack);
    const stackInBlock = stackEscaped.length <= maxBlockLength - 15
      ? stackEscaped
      : stackEscaped.slice(0, maxBlockLength - 25) + '\n… (обрезано)';
    const full = `${prefix}${codeWrap}${stackInBlock}${codeWrapEnd}`;
    return full.length <= this.MAX_ERROR_MESSAGE_LENGTH ? full : full.slice(0, this.MAX_ERROR_MESSAGE_LENGTH - 10) + '…';
  };

  private sendErrorToUser = async (telegramId: string, err: unknown): Promise<void> => {
    try {
      await this.telegramService.sendMessage(this.formatErrorForChat(err), telegramId);
    } catch (sendErr) {
      console.error('Failed to send error to user:', sendErr);
    }
  };

  private isAdmin = (user: UserEntity): boolean => {
    return user.admin;
  };

  private ensureUser = async (ctx: Context): Promise<UserEntity> => {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      throw new Error('Telegram id not found in context');
    }

    let user = await UserEntity.findOne({ where: { telegramId } });
    if (!user) {
      user = new UserEntity();
      user.telegramId = telegramId;
    }

    user.username = ctx.from?.username ?? user.username ?? null;
    user.firstName = ctx.from?.first_name ?? user.firstName ?? null;
    user.lastName = ctx.from?.last_name ?? user.lastName ?? null;

    return user.save();
  };

  private getOrCreateState = async (telegramId: string): Promise<TelegramDialogStateEntity> => {
    let state = await TelegramDialogStateEntity.findOne({ where: { telegramId } });
    if (!state) {
      state = new TelegramDialogStateEntity();
      state.telegramId = telegramId;
      state.state = TelegramDialogStateEnum.IDLE;
      state.data = {};
      await state.save();
    }
    return state;
  };

  private setState = async (telegramId: string, nextState: TelegramDialogStateEnum, data?: Record<string, any>): Promise<TelegramDialogStateEntity> => {
    const state = await this.getOrCreateState(telegramId);
    state.state = nextState;
    state.data = data ?? state.data ?? {};
    await state.save();
    return state;
  };

  /** Отправляет пользователю файлы, привязанные к использованным знаниям (скачивает из S3 и отправляет буфером). */
  private sendKnowledgeFiles = async (telegramId: string, knowledgeIds: number[]): Promise<void> => {
    if (!knowledgeIds.length) {
      return;
    }
    const knowledges = await KnowledgeBaseEntity.find({
      where: { id: In(knowledgeIds) },
      relations: ['files'],
    });
    const seenFileIds = new Set<number>();
    for (const knowledge of knowledges) {
      if (!knowledge.files?.length) {
        continue;
      }
      for (const file of knowledge.files) {
        if (!file.id || !file.storageKey?.trim() || seenFileIds.has(file.id)) {
          continue;
        }
        seenFileIds.add(file.id);
        try {
          const buffer = await this.fileStorageService.getBuffer(file.storageKey);
          await this.telegramBotService.sendFileFromBuffer(telegramId, buffer, file.mime, file.originalName);
        } catch (e) {
          this.loggerService.error(this.TAG, `Ошибка отправки файла на telegramId ${telegramId}`, e);
        }
      }
    }
  };

  private handleAdminText = async (user: UserEntity, text: string): Promise<boolean> => {
    const trimmed = text.trim();

    if (trimmed === this.ADMIN_UPLOAD_COMMAND) {
      await this.setState(user.telegramId, TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_TITLE, { fileIds: [] });
      await this.telegramService.sendMessage(
        this.formatUploadStepMessage(1, 'Введите заголовок знания. В любой момент можно нажать «Сбросить».'),
        user.telegramId,
        { reply_markup: this.getAdminStepResetKeyboard().reply_markup },
      );
      return true;
    }

    const state = await this.getOrCreateState(user.telegramId);

    if (trimmed === this.ADMIN_RESET_COMMAND) {
      const inUpload = state.state === TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_TITLE || state.state === TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_TEXT || state.state === TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_FILES;
      if (inUpload) {
        await this.setState(user.telegramId, TelegramDialogStateEnum.IDLE, {});
        await this.telegramService.sendMessage(
          'Состояние сброшено. Можно начать заново с кнопки «Загрузить информацию».',
          user.telegramId,
          { reply_markup: this.getAdminMainKeyboard().reply_markup },
        );
        return true;
      }
    }

    if (state.state === TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_TITLE) {
      const data = state.data || {};
      data.title = trimmed;
      await this.setState(user.telegramId, TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_TEXT, data);
      await this.telegramService.sendMessage(
        this.formatUploadStepMessage(2, 'Отправьте основной текст знания или нажмите «Текст не нужен, у меня файлы».'),
        user.telegramId,
        { reply_markup: this.getAdminTextStepKeyboard().reply_markup },
      );
      return true;
    }

    if (state.state === TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_TEXT) {
      const data = state.data || {};

      if (trimmed === this.ADMIN_SKIP_TEXT_COMMAND) {
        const filesStepData = { ...data, pendingFileCount: 0 };
        await this.setState(user.telegramId, TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_FILES, filesStepData);
        await this.telegramService.sendMessage(
          this.formatUploadStepMessage(3, 'Прикрепите файлы, которые будут выдаваться в результате ответа пользователю (PDF, изображения, видео) или нажмите «Готово», если файлов нет.'),
          user.telegramId,
          { reply_markup: this.getAdminFilesStepKeyboard().reply_markup },
        );
        return true;
      }

      data.content = trimmed;
      const filesStepData = { ...data, pendingFileCount: 0 };
      await this.setState(user.telegramId, TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_FILES, filesStepData);
      await this.telegramService.sendMessage(
        this.formatUploadStepMessage(3, 'Прикрепите файлы, которые будут выдаваться в результате ответа пользователю (PDF, изображения, видео) или нажмите «Готово», если файлов нет.'),
        user.telegramId,
        { reply_markup: this.getAdminFilesStepKeyboard().reply_markup },
      );
      return true;
    }

    if (state.state === TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_FILES && trimmed === this.ADMIN_FINISH_FILES_COMMAND) {
      const pendingFileCount = state.data?.pendingFileCount ?? 0;
      if (pendingFileCount > 0) {
        await this.telegramService.sendMessage(
          'Дождитесь завершения загрузки всех файлов — кнопка «Готово» будет доступна после обработки.',
          user.telegramId,
          { reply_markup: this.getAdminFilesStepKeyboardWithoutDone().reply_markup },
        );
        return true;
      }
      await this.finishAdminUpload(user, state);
      return true;
    }

    return false;
  };

  private handleProfileText = async (user: UserEntity, text: string): Promise<boolean> => {
    const state = await this.getOrCreateState(user.telegramId);
    const trimmed = text.trim();

    if (state.state === TelegramDialogStateEnum.PROFILE_WAIT_MODEL) {
      if (user) {
        user.carModel = trimmed;
        await user.save();
      }

      await this.setState(user.telegramId, TelegramDialogStateEnum.PROFILE_WAIT_YEAR);
      await this.telegramService.sendMessage(
        'Введите год выпуска автомобиля (например, 2018):',
        user.telegramId,
        { reply_markup: this.getCancelKeyboard().reply_markup },
      );
      return true;
    }

    if (state.state === TelegramDialogStateEnum.PROFILE_WAIT_YEAR) {
      const year = Number.parseInt(trimmed, 10);
      if (user && !Number.isNaN(year)) {
        user.carYear = year;
        await user.save();
      }

      await this.setState(user.telegramId, TelegramDialogStateEnum.PROFILE_WAIT_MILEAGE);
      await this.telegramService.sendMessage(
        'Введите пробег автомобиля в километрах (например, 95000):',
        user.telegramId,
        { reply_markup: this.getCancelKeyboard().reply_markup },
      );
      return true;
    }

    if (state.state === TelegramDialogStateEnum.PROFILE_WAIT_MILEAGE) {
      const mileage = Number.parseInt(trimmed, 10);
      if (user && !Number.isNaN(mileage)) {
        user.carMileage = mileage;
        await user.save();
      }

      await this.setState(user.telegramId, TelegramDialogStateEnum.IDLE, {});
      await this.telegramService.sendMessage('Профиль автомобиля сохранён. Эти данные будут учитываться при ответах.', user.telegramId);
      return true;
    }

    if (state.state === TelegramDialogStateEnum.FEEDBACK_WAIT_CORRECTION && state.data?.historyId) {
      const historyId: number = state.data.historyId;
      const history = await ResponseHistoryEntity.findOne({ where: { id: historyId } });

      if (history) {
        history.correction = text.trim();
        await history.save();
      }

      await this.setState(user.telegramId, TelegramDialogStateEnum.IDLE, {});
      await this.telegramService.sendMessage('Спасибо, ваша корректировка сохранена и будет использована для улучшения ответов.', user.telegramId);
      return true;
    }

    return false;
  };

  private finishAdminUpload = async (user: UserEntity, state: TelegramDialogStateEntity): Promise<void> => {
    const data = state.data || {};
    const title: string | undefined = data.title;
    const content: string | undefined = data.content;
    const fileIds: number[] = data.fileIds || [];

    const hasTitle = typeof title === 'string' && title.trim().length > 0;
    const hasContent = typeof content === 'string' && content.trim().length > 0;
    const hasFiles = fileIds.length > 0;

    if (!hasTitle || (!hasContent && !hasFiles)) {
      await this.telegramService.sendMessage(
        'Не удалось сохранить знание: не заполнены заголовок или текст, и не прикреплены файлы.',
        user.telegramId,
        { reply_markup: this.getAdminMainKeyboard().reply_markup },
      );
      await this.setState(user.telegramId, TelegramDialogStateEnum.IDLE, {});
      return;
    }

    const files = hasFiles
      ? await FileEntity.find({ where: { id: In(fileIds) } })
      : undefined;

    const { knowledge, totalContentLength } = await this.knowledgeBaseCrudService.createOne({
      title: title as string,
      content: hasContent ? (content as string) : '',
      files: files ?? [],
    });

    if (!knowledge) {
      await this.telegramService.sendMessage(
        'Знание не было сохранено (текст мог быть отфильтрован как пустой или служебный). Заполните заголовок и текст заново.',
        user.telegramId,
        { reply_markup: this.getAdminMainKeyboard().reply_markup },
      );
      await this.setState(user.telegramId, TelegramDialogStateEnum.IDLE, {});
      return;
    }

    await this.setState(user.telegramId, TelegramDialogStateEnum.IDLE, {});

    const attachedFilesDescription = hasFiles
      ? `Файлы: ${fileIds.length}`
      : 'Файлы: нет';

    await this.telegramService.sendMessage(
      [
        'Знание успешно сохранено.',
        `ID: ${knowledge.id}`,
        `Заголовок: ${knowledge.title}`,
        `Длина текста: ${totalContentLength} символов`,
        attachedFilesDescription,
      ],
      user.telegramId,
      { reply_markup: this.getAdminMainKeyboard().reply_markup },
    );
  };

  private processDocumentInBackground = async (fileId: string, fileName: string, mimeType: string, user: UserEntity): Promise<void> => {
    const telegram = this.telegramBotService.getBot().telegram;
    const fileEntity = await this.downloadAndSaveTelegramFile(telegram, fileId, fileName, mimeType, user);

    const state = await this.getOrCreateState(user.telegramId);
    const data = state.data || {};
    const fileIds: number[] = data.fileIds || [];
    fileIds.push(fileEntity.id);
    const pendingFileCount = Math.max(0, (data.pendingFileCount ?? 0) - 1);
    state.data = { ...data, fileIds, pendingFileCount };
    await state.save();

    const replyMarkup = pendingFileCount === 0
      ? this.getAdminFilesStepKeyboard().reply_markup
      : this.getAdminFilesStepKeyboardWithoutDone().reply_markup;

    await this.telegramService.sendMessage(
      this.formatUploadStepMessage(3, `Файл «${fileName}» сохранён. Прикрепите ещё файлы или нажмите «Готово».`),
      user.telegramId,
      { reply_markup: replyMarkup },
    );
  };

  private processPhotoInBackground = async (fileId: string, fileName: string, user: UserEntity): Promise<void> => {
    const telegram = this.telegramBotService.getBot().telegram;
    const fileEntity = await this.downloadAndSaveTelegramFile(telegram, fileId, fileName, 'image/jpeg', user);

    const state = await this.getOrCreateState(user.telegramId);
    const data = state.data || {};
    const fileIds: number[] = data.fileIds || [];
    fileIds.push(fileEntity.id);
    const pendingFileCount = Math.max(0, (data.pendingFileCount ?? 0) - 1);
    state.data = { ...data, fileIds, pendingFileCount };
    await state.save();

    const replyMarkup = pendingFileCount === 0
      ? this.getAdminFilesStepKeyboard().reply_markup
      : this.getAdminFilesStepKeyboardWithoutDone().reply_markup;

    await this.telegramService.sendMessage(
      this.formatUploadStepMessage(3, 'Фото сохранено. Прикрепите ещё файлы или нажмите «Готово».'),
      user.telegramId,
      { reply_markup: replyMarkup },
    );
  };

  private decrementPendingFileCountAndUpdateKeyboard = async (telegramId: string): Promise<void> => {
    const state = await this.getOrCreateState(telegramId);
    if (state.state !== TelegramDialogStateEnum.ADMIN_UPLOAD_WAIT_FILES) {
      return;
    }
    const data = state.data || {};
    const pendingFileCount = Math.max(0, (data.pendingFileCount ?? 0) - 1);
    state.data = { ...data, pendingFileCount };
    await state.save();

    if (pendingFileCount === 0) {
      await this.telegramService.sendMessage(
        this.formatUploadStepMessage(3, 'Можно прикрепить ещё файлы или нажмите «Готово».'),
        telegramId,
        { reply_markup: this.getAdminFilesStepKeyboard().reply_markup },
      );
    }
  };

  private downloadAndSaveTelegramFile = async (
    telegram: { getFileLink: (fileId: string) => Promise<{ toString(): string } | URL> },
    fileId: string,
    fileName: string,
    mimeType: string,
    user: UserEntity,
  ): Promise<FileEntity> => {
    const link = await telegram.getFileLink(fileId);
    const url = String(link);

    const proxyAgent = this.telegramBotService.getSocksProxyAgent();
    const axiosConfig = proxyAgent
      ? {
        httpAgent: proxyAgent,
        httpsAgent: proxyAgent,
        responseType: 'arraybuffer' as const,
      }
      : { responseType: 'arraybuffer' as const };

    const response = await axios.get<ArrayBuffer>(url, axiosConfig);
    const buffer = Buffer.from(response.data);

    const key = `telegram/${user.telegramId}/${Date.now()}_${fileName}`;

    await this.fileStorageService.uploadBuffer(key, buffer, mimeType);

    const file = new FileEntity();
    file.originalName = fileName;
    file.mime = mimeType;
    file.size = buffer.length;
    file.storageKey = key;
    file.publicUrl = this.fileStorageService.getPublicUrl(key);

    return file.save();
  };

  private downloadTelegramFileAsBuffer = async (
    telegram: { getFileLink: (fileId: string) => Promise<{ toString(): string } | URL> },
    fileId: string,
  ): Promise<Buffer> => {
    const link = await telegram.getFileLink(fileId);
    const url = String(link);

    const proxyAgent = this.telegramBotService.getSocksProxyAgent();
    const axiosConfig = proxyAgent
      ? {
        httpAgent: proxyAgent,
        httpsAgent: proxyAgent,
        responseType: 'arraybuffer' as const,
      }
      : { responseType: 'arraybuffer' as const };

    const response = await axios.get<ArrayBuffer>(url, axiosConfig);
    return Buffer.from(response.data);
  };

  private handleUserFileQuestion = async (
    user: UserEntity,
    payload: { fileId: string; fileName: string; mimeType: string; caption?: string | null },
  ): Promise<void> => {
    const telegram = this.telegramBotService.getBot().telegram;

    const fileEntity = await this.downloadAndSaveTelegramFile(
      telegram,
      payload.fileId,
      payload.fileName,
      payload.mimeType,
      user,
    );

    const isImage = payload.mimeType.startsWith('image/');
    let imageBase64List: string[] | undefined;
    if (isImage && fileEntity.storageKey) {
      const buffer = await this.fileStorageService.getBuffer(fileEntity.storageKey);
      imageBase64List = [buffer.toString('base64')];
    }

    const extractedText = await this.fileParserService.extractTextFromFile(fileEntity);

    const caption = (payload.caption ?? '').trim();
    const hasCaption = caption.length > 0;
    const hasExtractedText = extractedText.trim().length > 0;

    if (!hasCaption && !hasExtractedText) {
      if (imageBase64List?.length) {
        this.scheduleSupportAnswerWithSpinner(user.telegramId, () =>
          this.supportOrchestratorService.answerUserQuestion(
            user.telegramId,
            '[Пользователь прикрепил фото]',
            undefined,
            imageBase64List,
          ),
        );
        return;
      }
      await this.telegramService.sendMessage(
        'Я получил файл, но не смог извлечь из него текст. Пожалуйста, напишите текстовый вопрос или пришлите файл с текстом (PDF или изображение с читаемым текстом).',
        user.telegramId,
      );
      return;
    }

    if (hasCaption && !hasExtractedText) {
      this.scheduleSupportAnswerWithSpinner(user.telegramId, () =>
        this.supportOrchestratorService.answerUserQuestion(
          user.telegramId,
          caption,
          undefined,
          imageBase64List,
        ),
      );
      return;
    }

    const question = hasCaption
      ? caption
      : 'Проанализируй содержимое этого файла и объясни, что из него важно владельцу автомобиля.';

    this.scheduleSupportAnswerWithSpinner(user.telegramId, () =>
      this.supportOrchestratorService.answerUserQuestion(
        user.telegramId,
        question,
        [extractedText],
        imageBase64List,
      ),
    );
  };

  /** Без await: иначе Telegraf не обработает следующий апдейт (/stop, callback) до конца ответа модели. */
  private scheduleSupportAnswerWithSpinner = (
    telegramId: string,
    runAnswer: () => Promise<{
      answer: string;
      historyId?: number;
      usedKnowledgeIds?: number[];
      isClarification?: boolean;
    }>,
    spinnerBaseText = 'Готовлю ответ',
  ): void => {
    void this.deliverSupportAnswerWithSpinner(telegramId, runAnswer, spinnerBaseText).catch((err) => {
      this.loggerService.error(this.TAG, 'scheduleSupportAnswerWithSpinner', err);
      void this.sendErrorToUser(telegramId, err);
    });
  };

  private deliverSupportAnswerWithSpinner = async (
    telegramId: string,
    runAnswer: () => Promise<{
      answer: string;
      historyId?: number;
      usedKnowledgeIds?: number[];
      isClarification?: boolean;
    }>,
    spinnerBaseText = 'Готовлю ответ',
  ): Promise<void> => {
    const spinner = await this.createSpinner(telegramId, spinnerBaseText);
    let triggerCancelAnswer: () => void = () => undefined;
    const cancelPromise = new Promise<never>((_, reject) => {
      triggerCancelAnswer = () => reject(new Error('Cancelled'));
    });
    this.cancelAnswerByTelegramId.set(telegramId, triggerCancelAnswer);
    try {
      const result = await Promise.race([runAnswer(), cancelPromise]);
      const inlineKeyboard = result.historyId
        ? Markup.inlineKeyboard([
          [
            Markup.button.callback('👍 Полезно', `fb:${result.historyId}:USEFUL`),
            Markup.button.callback('👎 Не полезно', `fb:${result.historyId}:NOT_USEFUL`),
          ],
        ])
        : undefined;
      const replyMarkup = result.isClarification
        ? this.getCancelKeyboard().reply_markup
        : inlineKeyboard?.reply_markup;
      await spinner.finish(result.answer, replyMarkup);
      const knowledgeIdList = result.usedKnowledgeIds ?? [];
      if (knowledgeIdList.length) {
        await this.sendKnowledgeFiles(telegramId, knowledgeIdList);
      }
    } catch (err) {
      spinner.stop();
      if (err instanceof Error && err.message === 'Cancelled') {
        await spinner.finish(this.CANCELLED_ANSWER_MESSAGE);
      } else {
        await this.sendErrorToUser(telegramId, err);
      }
    } finally {
      this.cancelAnswerByTelegramId.delete(telegramId);
    }
  };

  private createSpinner = async (telegramId: string, baseText: string) => {
    let dotStep = 0;
    let messageId: number | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stopKeyboard = { inline_keyboard: [[{ text: '⛔ Остановить', callback_data: `stop:${telegramId}` }]] };

    const renderText = () => `${DOTS[dotStep]} ${baseText}...`;

    const sent = await this.telegramService
      .sendMessage(renderText(), telegramId, { reply_markup: stopKeyboard } as any)
      .catch(() => undefined);
    messageId = sent?.message_id ?? null;

    const updateText = async (newBase: string) => {
      baseText = newBase;
      if (messageId) {
        await this.telegramService
          .editMessage(renderText(), telegramId, messageId, { reply_markup: stopKeyboard } as any)
          .catch(() => undefined);
      }
    };

    if (messageId) {
      timer = setInterval(async () => {
        dotStep = (dotStep + 1) % DOTS.length;
        await this.telegramService
          .editMessage(renderText(), telegramId, messageId, { reply_markup: stopKeyboard } as any)
          .catch(() => undefined);
      }, 3000);
    }

    const stop = () => {
      if (timer) {
        clearInterval(timer); timer = null;
      }
    };

    const finish = async (finalText: string, replyMarkup?: object) => {
      stop();
      if (messageId) {
        await this.telegramService
          .editMessage(finalText, telegramId, messageId, replyMarkup ? { reply_markup: replyMarkup } as any : undefined)
          .catch(() => undefined);
      } else {
        await this.telegramService.sendMessage(finalText, telegramId, replyMarkup ? { reply_markup: replyMarkup } as any : undefined);
      }
    };

    return { messageId, updateText, stop, finish };
  };
}

