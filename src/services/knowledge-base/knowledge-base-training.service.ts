import * as crypto from 'crypto';
import { Container, Singleton } from 'typescript-ioc';
import _ from 'lodash';

import { ModelBaseService } from '@/services/model/model-base.service';
import { KnowledgeBaseQueryService, type QueryingOptions } from '@/services/knowledge-base/knowledge-base-query.service';
import { FileParserService } from '@/services/file/file-parser.service';
import { AgentEntity } from '@/db/entities/agent.entity';
import { KnowledgeBaseEntity } from '@/db/entities/knowledge-base.entity';
import { FileEntity } from '@/db/entities/file.entity';
import type { KnowledgeBaseFormInterface, KnowledgeBasePartialFormInterface } from '@/services/knowledge-base/knowledge-base-crud.service';


@Singleton
export class KnowledgeBaseTrainingService extends ModelBaseService {

  private readonly knowledgeBaseQueryService = Container.get(KnowledgeBaseQueryService);

  private readonly fileParserService = Container.get(FileParserService);

  /** Добавление информации в базу знаний */
  public addDocumentToKnowledgeBase = async (body: KnowledgeBaseFormInterface, options?: QueryingOptions): Promise<KnowledgeBaseEntity[]> => {
    const manager = options?.manager || this.databaseService.getManager();
    const knowledgeBaseRepo = manager.getRepository(KnowledgeBaseEntity);
    await this.documentProcessing(body);
    const savedIds: number[] = [];

    if (body.content.length > 8192) {
      this.loggerService.warn(`Knowleadge base content is very long: ${body.content.length}. Will break it into different parts...`);
      const contentParts: string[] = [];
      for (let offset = 0; offset < body.content.length; offset += 8192) {
        const partContent = body.content.substring(offset, Math.min(offset + 8192, body.content.length)).trim().replace(/\s+/g, ' ');
        if (partContent.length) {
          contentParts.push(partContent);
        }
      }

      type PreparedPart = {
        content: string;
        embedding1536: number[];
        embedding1024: number[];
        embedding256: number[];
      };

      const preparedParts: PreparedPart[] = [];

      for (const partContent of contentParts) {
        if (this.isGarbageText(partContent)) {
          continue;
        }

        const embeddings = await this.generateEmbeddings(partContent, { manager });
        const [embedding1536, embedding1024, embedding256] = this.normalizeEmbeddings(embeddings);
        const hasAnyEmbedding = embedding1536.length > 0 || embedding1024.length > 0 || embedding256.length > 0;
        if (!hasAnyEmbedding) {
          this.loggerService.warn('No embedding agents active or no embeddings returned; skipping knowledge base entry part.');
          continue;
        }

        preparedParts.push({
          content: partContent,
          embedding1536,
          embedding1024,
          embedding256,
        });
      }

      const partsCount = preparedParts.length;

      for (let partIndex = 0; partIndex < partsCount; partIndex += 1) {
        const part = preparedParts[partIndex];
        const entity = new KnowledgeBaseEntity();

        if (partsCount > 1) {
          entity.title = `${body.title} (часть ${partIndex + 1} из ${partsCount})`;
        } else {
          entity.title = body.title;
        }

        entity.content = part.content;
        entity.contentHash = this.getContentHash(part.content);

        if (body.files?.length) {
          entity.files = body.files;
        }

        entity.embedding1536 = part.embedding1536;
        entity.embedding1024 = part.embedding1024;
        entity.embedding256 = part.embedding256;

        const saved = await knowledgeBaseRepo.save(entity);
        savedIds.push(saved.id);
      }
    } else {
      const preparedKnowledges: KnowledgeBaseFormInterface[] = [body];

      for (const knowledge of preparedKnowledges) {
        if (this.isGarbageText(knowledge.content)) {
          continue;
        }

        const contentHash = this.getContentHash(knowledge.content);
        const embeddings = await this.generateEmbeddings(knowledge.content, { manager });
        const entity = new KnowledgeBaseEntity();
        entity.title = knowledge.title;
        entity.content = knowledge.content;
        entity.contentHash = contentHash;

        if (knowledge.files?.length) {
          entity.files = knowledge.files;
        }

        const [embedding1536, embedding1024, embedding256] = this.normalizeEmbeddings(embeddings);
        const hasAnyEmbedding = embedding1536.length > 0 || embedding1024.length > 0 || embedding256.length > 0;
        if (!hasAnyEmbedding) {
          this.loggerService.warn('No embedding agents active or no embeddings returned; skipping knowledge base entry.');
          continue;
        }
        entity.embedding1536 = embedding1536;
        entity.embedding1024 = embedding1024;
        entity.embedding256 = embedding256;

        const saved = await knowledgeBaseRepo.save(entity);
        savedIds.push(saved.id);
      }
    }

    if (!savedIds.length) {
      return [];
    }

    const builder = this.knowledgeBaseQueryService.createQueryBuilder({ manager });
    this.knowledgeBaseQueryService.applyIncludeIdsFilter(builder, _.uniq(savedIds));

    return builder.getMany();
  };

  /** Изменение информации в базе знаний */
  public updateDocumentToKnowledgeBase = async (before: KnowledgeBaseEntity, body: KnowledgeBasePartialFormInterface, options?: QueryingOptions): Promise<KnowledgeBaseEntity | null> => {
    const manager = options?.manager || this.databaseService.getManager();
    const knowledgeBaseRepo = manager.getRepository(KnowledgeBaseEntity);

    await this.documentProcessing(body);

    const hasContent = typeof body.content === 'string' && body.content.length > 0;

    if (hasContent && before.content !== body.content) {
      const embeddings = await this.generateEmbeddings(body.content as string, { manager });

      const updateData: Partial<KnowledgeBaseEntity> = {
        title: body.title ?? before.title,
        content: body.content ?? before.content,
        contentHash: this.getContentHash(body.content as string),
      };

      if (body.files?.length) {
        updateData.files = body.files;
      }

      const [embedding1536, embedding1024, embedding256] = this.normalizeEmbeddings(embeddings);
      const hasAnyEmbedding = embedding1536.length > 0 || embedding1024.length > 0 || embedding256.length > 0;
      if (hasAnyEmbedding) {
        updateData.embedding1536 = embedding1536;
        updateData.embedding1024 = embedding1024;
        updateData.embedding256 = embedding256;
      }

      await knowledgeBaseRepo.update(before.id, updateData);
    } else {
      const updateData: Partial<KnowledgeBaseEntity> = {};

      if (typeof body.title === 'string') {
        updateData.title = body.title;
      }
      if (body.files?.length) {
        updateData.files = body.files;
      }

      if (Object.keys(updateData).length) {
        await knowledgeBaseRepo.update(before.id, updateData);
      }
    }

    const builder = this.knowledgeBaseQueryService.createQueryBuilder({ manager });
    this.knowledgeBaseQueryService.applyIncludeIdsFilter(builder, [before.id]);

    return builder.getOne();
  };

  public batchAddDocuments = async (documents: KnowledgeBaseFormInterface[], options?: QueryingOptions): Promise<KnowledgeBaseEntity[]> => {
    const results: KnowledgeBaseEntity[] = [];

    for (const doc of documents) {
      const result = await this.addDocumentToKnowledgeBase(doc, options);
      results.push(...result);
    }

    return results.flat();
  };

  private generateEmbeddings = async (content: string, options?: QueryingOptions): Promise<number[][]> => {
    const manager = options?.manager || this.databaseService.getManager();
    const agentRepo = manager.getRepository(AgentEntity);

    const agents = await agentRepo.find({ where: { isEmbedding: true, isActive: true } });

    if (!agents.length) {
      return [];
    }

    const models = agents.map(agent => this.getEmbeddingModel(agent));

    return Promise.all(models.map(model => model.embedQuery(content)));
  };

  private normalizeEmbeddings = (embeddings: number[][]): [number[], number[], number[]] => {
    let embedding1536: number[] = [];
    let embedding1024: number[] = [];
    let embedding256: number[] = [];

    for (const embedding of embeddings) {
      if (embedding.length === 1536) {
        embedding1536 = embedding;
      } else if (embedding.length === 1024) {
        embedding1024 = embedding;
      } else if (embedding.length === 256) {
        embedding256 = embedding;
      }
    }

    return [embedding1536, embedding1024, embedding256];
  };

  private getContentHash = (content: string): string => {
    return crypto.createHash('md5').update(content).digest('hex');
  };

  private documentProcessing = async (body: KnowledgeBasePartialFormInterface): Promise<void> => {
    const userContent = typeof body.content === 'string' ? body.content.trim() : '';
    if (!userContent && body.files?.length) {
      const parts: string[] = [];
      for (const fileRef of body.files) {
        const file = await FileEntity.findOne({ where: { id: fileRef.id } });
        if (file) {
          const fileContent = await this.fileParserService.extractTextFromFile(file);
          if (fileContent?.trim()) {
            parts.push(fileContent.trim());
          }
        }
      }
      if (parts.length) {
        body.content = parts.join('\n\n');
      }
    }

    if (body.content) {
      body.content = body.content.trim().replace(/\s+/g, ' ').replace(/<img[^>]*src="data:image\/[^;]+;base64,[^"]+"[^>]*>/g, '');
    }
  };

  /** Check if text is garbage */
  private isGarbageText = (text: string): boolean => {
    if (!text || !text.trim().length) {
      return true;
    }

    const trimmedText = text.trim();

    // 3. Проверяем признаки "мусорного" текста
    const garbagePatterns = [
    // Высокая плотность специальных символов и цифр
      /^[^a-zA-Zа-яА-ЯёЁ\s]{20,}$/,
      // Много повторяющихся паттернов
      /(.)\1{10,}/,
      // Текст с множеством одиночных символов и специальных символов
      /^([^a-zA-Zа-яА-ЯёЁ\s]{2,}\s*){15,}$/,
      // Текст с хаотичным смешением символов
      /^([a-zA-Z0-9@#$%^&*()_+=\\[\]{};':"\\|,.<>/?-]\s*){30,}$/,
    ];

    for (const pattern of garbagePatterns) {
      if (pattern.test(trimmedText)) {
        return true;
      }
    }

    // 4. Анализ структуры текста
    const words = trimmedText.split(/\s+/);

    // Считаем "осмысленные" слова (длина > 2 и содержат буквы)
    const meaningfulWords = words
      .filter(word => {
        if (word.length < 3) {
          return false;
        }
        const letterCount = (word.match(/[a-zA-Zа-яА-ЯёЁ]/g) || []).length;
        return letterCount >= 3;
      })
      .length;

    // Считаем одиночные символы
    const singleCharWords = words.filter(word => word.length === 1).length;

    // Считаем слова только из специальных символов
    const specialCharWords = words.filter(word => !/[a-zA-Zа-яА-ЯёЁ0-9]/.test(word) && word.length).length;

    // 5. Критерии для определения мусора
    const totalWords = words.length;

    // Если более 80% слов - одиночные символы
    if (totalWords > 10 && (singleCharWords / totalWords) > 0.8) {
      return true;
    }

    // Если более 70% слов - специальные символы
    if (totalWords > 10 && (specialCharWords / totalWords) > 0.7) {
      return true;
    }

    // Если менее 5% слов - осмысленные
    if (totalWords > 20 && (meaningfulWords / totalWords) < 0.05) {
      return true;
    }

    // 6. Проверка энтропии (случайность символов)
    const charFrequency: Record<string, number> = {};
    const relevantChars = trimmedText.replace(/\s/g, '');

    for (const char of relevantChars) {
      charFrequency[char] = (charFrequency[char] || 0) + 1;
    }

    // Если много уникальных символов с низкой частотой
    const uniqueChars = Object.keys(charFrequency).length;
    if (relevantChars.length > 50 && uniqueChars / relevantChars.length > 0.8) {
    // Высокая энтропия - признак случайного текста
      return true;
    }

    return false;
  };
}
