import { Container, Singleton } from 'typescript-ioc';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { In, type EntityManager } from 'typeorm';

import { ModelBaseService } from '@/services/model/model-base.service';
import { KnowledgeBaseService } from '@/services/knowledge-base/knowledge-base.service';
import { AgentEntity } from '@/db/entities/agent.entity';
import { KnowledgeBaseEntity } from '@/db/entities/knowledge-base.entity';
import { ResponseHistoryEntity } from '@/db/entities/response-history.entity';
import { TelegramDialogStateEnum, TelegramDialogStateEntity } from '@/db/entities/telegram-dialog-state.entity';
import { UserEntity } from '@/db/entities/user.entity';

interface OrchestratorResult {
  answer: string;
  knowledgeIds: number[];
  confidence: number;
  historyId?: number;
  /** true, если бот задал уточняющий вопрос и ждёт ответа */
  isClarification?: boolean;
}

@Singleton
export class SupportAgentOrchestratorService extends ModelBaseService {
  private readonly TAG = 'SupportAgentOrchestratorService';

  private readonly knowledgeBaseService = Container.get(KnowledgeBaseService);

  public answerUserQuestion = async (
    telegramId: string,
    text: string,
    fileContents?: string[],
    imageBase64List?: string[],
  ): Promise<OrchestratorResult> => {
    const manager = this.databaseService.getManager();

    const state = await TelegramDialogStateEntity.findOne({ where: { telegramId } });

    let question = text.trim();
    let isContinuation = false;

    if (state?.state === 'USER_CLARIFICATION_WAITING' && state.data?.originalQuestion) {
      question = `${state.data.originalQuestion}\nУточнение пользователя: ${text.trim()}`;
      isContinuation = true;
    }

    const { chatAgent, embeddingAgent } = await this.getAgents(manager);

    if (!chatAgent || !embeddingAgent) {
      const fallback = 'Модель ИИ ещё не настроена. Обратитесь к администратору.';
      return {
        answer: fallback,
        knowledgeIds: [],
        confidence: 0,
      };
    }

    const startedAt = Date.now();

    const [knowledges, confidence] = await this.knowledgeBaseService.searchInKnowledgeBase(
      embeddingAgent,
      question,
      { manager, limit: 3 },
    );
    const threshold = embeddingAgent.minConfidence ?? 0.85;

    const hasFileContext =
      (Array.isArray(fileContents) && fileContents.some((content) => typeof content === 'string' && content.trim().length > 0)) ||
      (Array.isArray(imageBase64List) && imageBase64List.length > 0);

    const shouldClarify = !hasFileContext && (!knowledges.length || confidence < threshold);

    if (shouldClarify) {
      const clarificationQuestion = await this.runClarificationAgent(chatAgent, question, telegramId, imageBase64List);

      await this.setClarificationState(telegramId, question);

      return {
        answer: clarificationQuestion,
        knowledgeIds: [],
        confidence,
        isClarification: true,
      };
    }

    if (state && isContinuation) {
      state.state = TelegramDialogStateEnum.IDLE;
      state.data = {
        ...(state.data || {}),
      };
      await state.save();
    }

    const formattedAnswer = await this.runFormattingAgent(chatAgent, question, knowledges, telegramId, fileContents, imageBase64List);

    const knowledgeIds = knowledges.map(({ id }) => id);

    const responseTimeMs = Date.now() - startedAt;

    const historyId = await this.saveHistory(telegramId, question, formattedAnswer, confidence, knowledgeIds, responseTimeMs);

    await this.updateSummary(telegramId, question, formattedAnswer);

    return {
      answer: formattedAnswer,
      knowledgeIds,
      confidence,
      historyId,
    };
  };

  private getAgents = async (manager: EntityManager): Promise<{ chatAgent: AgentEntity | null; embeddingAgent: AgentEntity | null; }> => {
    const repo = manager.getRepository(AgentEntity);

    const agents = await repo.find({
      where: {
        isActive: true,
      },
    });

    const embeddingAgent = agents.find(agent => agent.isEmbedding) ?? null;
    const chatAgent = agents.find(agent => !agent.isEmbedding) ?? null;

    return { chatAgent, embeddingAgent };
  };

  /** Удаляет управляющие символы и невалидные символы, ломающие JSON при отправке в API */
  private sanitizeForApi = (text: string, maxLength = 0): string => {
    if (typeof text !== 'string') {
      return '';
    }
    let out = text
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .replace(/\uFFFD/g, ' ');
    if (maxLength > 0 && out.length > maxLength) {
      out = out.slice(-maxLength);
    }
    return out.trim() || text;
  };

  private runClarificationAgent = async (
    agent: AgentEntity,
    question: string,
    telegramId: string,
    imageBase64List?: string[],
  ): Promise<string> => {
    try {
      const model = this.getChatModel(agent);

      const user = await UserEntity.findOne({ where: { telegramId } });
      const profile = this.buildUserProfileDescription(user);

      const safeQuestion = this.sanitizeForApi(question, 6000);
      const safeProfile = profile ? this.sanitizeForApi(profile) : '';

      const systemContent = [
        'Ты Clarification Agent для техподдержки.',
        'Твоя задача — задать ОДИН уточняющий вопрос, который поможет лучше понять проблему пользователя.',
        'Если пользователь прислал фото — учти содержимое изображения при формулировке уточнения.',
        'Не предлагай ответ, только уточняющий вопрос.',
        'Язык: русский.',
        safeProfile ? `Профиль клиента: ${safeProfile}` : '',
      ].filter(Boolean).join('\n');

      const textBlock = { type: 'text' as const, text: safeQuestion ? `Вопрос пользователя:\n${safeQuestion}` : '[Пользователь прикрепил фото без текста]' };
      const hasImages = Array.isArray(imageBase64List) && imageBase64List.length > 0;
      const humanContent = hasImages
        ? [
            textBlock,
            ...imageBase64List.map((base64) => ({
              type: 'image_url' as const,
              // eslint-disable-next-line camelcase
              image_url: { url: `data:image/jpeg;base64,${base64}` },
            })),
          ]
        : [textBlock];

      const messages = [
        new SystemMessage(String(systemContent)),
        new HumanMessage(humanContent),
      ];

      const res = await model.invoke(messages);
      return res.text?.trim() || 'Пожалуйста, уточните, о чём именно идёт речь?';
    } catch (e) {
      this.loggerService.error(this.TAG, 'Clarification agent error', e);
      return 'Пожалуйста, уточните, о чём именно идёт речь?';
    }
  };

  private runFormattingAgent = async (
    agent: AgentEntity,
    question: string,
    knowledges: KnowledgeBaseEntity[],
    telegramId: string,
    fileContents?: string[],
    imageBase64List?: string[],
  ): Promise<string> => {
    try {
      const model = this.getChatModel(agent);

      const knowledgeBaseContent = knowledges
        .map((knowledge) => `Знание #${knowledge.id}: ${this.sanitizeForApi(knowledge.content)}`)
        .join('\n\n');

      const safeFileContents = (fileContents ?? [])
        .map((content, index) => {
          const safeText = this.sanitizeForApi(content, 8000);
          return `Файл клиента #${index + 1}:\n${safeText}`;
        })
        .filter((block) => block.trim().length > 0)
        .join('\n\n');

      const [state, user] = await Promise.all([
        TelegramDialogStateEntity.findOne({ where: { telegramId } }),
        UserEntity.findOne({ where: { telegramId } })
      ]);
      const summary: string | undefined = state?.data?.summary;

      const profile = this.buildUserProfileDescription(user);

      const safeQuestion = this.sanitizeForApi(question);
      const safeProfile = profile ? this.sanitizeForApi(profile) : '';
      const safeSummary = summary ? this.sanitizeForApi(summary) : '';

      const systemContent = [
        'Ты Formatting Agent для техподдержки.',
        'Отвечай только на основе предоставленного контента (база знаний, содержимое файлов и изображений клиента).',
        'Если клиент приложил фото — учти то, что на изображении, при формировании ответа.',
        'Не выдумывай факты.',
        'Формат ответа:',
        '- краткий и точный ответ;',
        '- при необходимости — шаги в виде списка;',
        '- без воды и домыслов.',
        'Язык ответа: русский.',
        safeProfile ? `Профиль клиента: ${safeProfile}` : '',
        safeSummary ? `Краткая история предыдущего диалога: ${safeSummary}` : '',
      ].filter(Boolean).join('\n');

      const textParts = [
        `Вопрос пользователя: "${safeQuestion}"`,
        '',
        '=== КОНТЕНТ БАЗЫ ЗНАНИЙ НАЧАЛО ===',
        knowledgeBaseContent || '(подходящие записи базы знаний не найдены)',
        '=== КОНТЕНТ БАЗЫ ЗНАНИЙ КОНЕЦ ===',
        '',
        safeFileContents
          ? [
            '=== КОНТЕНТ ФАЙЛОВ КЛИЕНТА НАЧАЛО ===',
            safeFileContents,
            '=== КОНТЕНТ ФАЙЛОВ КЛИЕНТА КОНЕЦ ===',
          ].join('\n')
          : '',
      ].filter(Boolean);

      const hasImages = Array.isArray(imageBase64List) && imageBase64List.length > 0;
      const humanContent = hasImages
        ? [
            { type: 'text' as const, text: textParts.join('\n') },
            ...imageBase64List.map((base64) => ({
              type: 'image_url' as const,
              // eslint-disable-next-line camelcase
              image_url: { url: `data:image/jpeg;base64,${base64}` },
            })),
          ]
        : textParts.join('\n');

      const messages = [
        new SystemMessage(systemContent),
        new HumanMessage(humanContent),
      ];

      const res = await model.invoke(messages);
      return res.text?.trim() || 'Сейчас нет достаточной информации для точного ответа.';
    } catch (e) {
      this.loggerService.error(this.TAG, 'Formatting agent error', e);
      return 'Произошла ошибка при формировании ответа. Попробуйте повторить запрос позже.';
    }
  };

  private setClarificationState = async (telegramId: string, originalQuestion: string): Promise<void> => {
    let state = await TelegramDialogStateEntity.findOne({ where: { telegramId } });
    if (!state) {
      state = new TelegramDialogStateEntity();
      state.telegramId = telegramId;
    }
    state.state = TelegramDialogStateEnum.USER_CLARIFICATION_WAITING;
    state.data = {
      ...(state.data || {}),
      originalQuestion,
    };
    await state.save();
  };

  private saveHistory = async (
    telegramId: string,
    question: string,
    response: string,
    confidence: number,
    knowledgeIds: number[],
    responseTimeMs: number,
  ): Promise<number | undefined> => {
    try {
      const history = new ResponseHistoryEntity();
      history.question = question;
      history.response = response;
      history.confidence = confidence;
      history.responseTimeMs = responseTimeMs;
      history.knowledgeIds = knowledgeIds;

      const user = await UserEntity.findOne({ where: { telegramId } });
      if (user) {
        history.user = user;
      }

      const saved = await history.save();

      if (knowledgeIds.length) {
        const kbList = await KnowledgeBaseEntity.find({
          where: {
            id: In(knowledgeIds),
          },
        });

        const ids = kbList.map(k => k.id);

        this.loggerService.info(
          this.TAG,
          `[${new Date().toISOString()}] Q/A: user=${telegramId} knowledge_ids=${JSON.stringify(ids)}`,
        );
      }

      return saved.id;
    } catch (e) {
      this.loggerService.error(this.TAG, 'Error saving response history', e);
      return undefined;
    }
  };

  private updateSummary = async (telegramId: string, question: string, answer: string): Promise<void> => {
    const state = await TelegramDialogStateEntity.findOne({ where: { telegramId } }) ?? new TelegramDialogStateEntity();

    if (!state.id) {
      state.telegramId = telegramId;
      state.state = TelegramDialogStateEnum.IDLE;
      state.data = {};
    }

    const data = state.data || {};
    const messagesCount: number = data.messagesCount ?? 0;
    const summary: string | undefined = data.summary;

    const nextMessagesCount = messagesCount + 1;

    if (nextMessagesCount < 5 && summary) {
      state.data = {
        ...data,
        messagesCount: nextMessagesCount,
      };
      await state.save();
      return;
    }

    const { chatAgent } = await this.getAgents(this.databaseService.getManager());
    if (!chatAgent) {
      return;
    }

    try {
      const model = this.getChatModel(chatAgent);
      const promptParts = [
        'Сделай краткое техническое summary диалога между клиентом и поддержкой.',
        'Сохрани только самые важные детали, которые полезны для будущих ответов.',
        'Язык: русский.',
      ];

      const previous = summary ? `Текущее summary: ${this.sanitizeForApi(summary)}` : 'Текущее summary отсутствует.';

      const messages = [
        new SystemMessage(promptParts.join('\n')),
        new HumanMessage([
          previous,
          '',
          'Новый вопрос и ответ:',
          `Вопрос: ${this.sanitizeForApi(question)}`,
          `Ответ: ${this.sanitizeForApi(answer)}`,
        ].join('\n')),
      ];

      const res = await model.invoke(messages);
      const nextSummary = res.text?.trim() || summary || '';

      state.data = {
        ...data,
        summary: nextSummary,
        messagesCount: 0,
      };
      await state.save();
    } catch (e) {
      this.loggerService.error(this.TAG, 'Error updating summary', e);
    }
  };

  private buildUserProfileDescription = (user?: UserEntity | null): string | null => {
    if (!user) {
      return null;
    }

    const parts: string[] = [];

    if (user.carModel) {
      parts.push(`автомобиль: ${user.carModel}`);
    }
    if (user.carYear) {
      parts.push(`год выпуска: ${user.carYear}`);
    }
    if (user.carMileage) {
      parts.push(`пробег: ${user.carMileage} км`);
    }

    if (!parts.length) {
      return null;
    }

    return parts.join(', ');
  };
}

