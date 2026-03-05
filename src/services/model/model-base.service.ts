import { AgentEntity } from '@/db/entities/agent.entity';
import { BaseService } from '@/services/app/base.service';
import { AgentTypeEnum } from '@/types/agent/enums/agent-type.enum';

import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { ChatMistralAI, MistralAIEmbeddings } from '@langchain/mistralai';
import { Singleton } from 'typescript-ioc';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

@Singleton
export abstract class ModelBaseService extends BaseService {

  protected getChatModel = (agent: AgentEntity): BaseChatModel => {
    let model: ChatMistralAI | ChatOpenAI;

    switch (agent.type) {
    case AgentTypeEnum.MISTRAL:
      model = new ChatMistralAI(agent);
      break;
    case AgentTypeEnum.OPENAI: {
      const modelName = agent.folderID && agent.model
        ? `gpt://${agent.folderID}/${agent.model}`
        : (agent.model ?? 'gpt-4o-mini');
      const configuration: { defaultHeaders?: Record<string, string>; baseURL?: string } = {};
      if (agent.folderID) {
        configuration.defaultHeaders = { 'OpenAI-Project': agent.folderID };
      }
      if (agent.baseURL) {
        configuration.baseURL = agent.baseURL;
      }
      const temperature = Number(agent.temperature);
      model = new ChatOpenAI({
        model: String(modelName),
        temperature: Number.isFinite(temperature) ? temperature : 0.7,
        apiKey: String(agent.apiKey ?? ''),
        ...(Object.keys(configuration).length ? { configuration } : {}),
      });
      break;
    }
    default:
      throw new Error(`Unsupported agent type: ${agent.type}`);
    }

    return model;
  };

  protected getEmbeddingModel = (agent: AgentEntity): MistralAIEmbeddings | OpenAIEmbeddings => {
    let model: MistralAIEmbeddings | OpenAIEmbeddings;

    switch (agent.type) {
    case AgentTypeEnum.MISTRAL:
      model = new MistralAIEmbeddings(agent);
      break;
    case AgentTypeEnum.OPENAI: {
      const modelName = agent.folderID && agent.model
        ? `emb://${agent.folderID}/${agent.model}`
        : (agent.model ?? 'text-embedding-3-small');
      const configuration: { defaultHeaders?: Record<string, string>; baseURL?: string } = {};
      if (agent.folderID) {
        configuration.defaultHeaders = { 'OpenAI-Project': agent.folderID };
      }
      if (agent.baseURL) {
        configuration.baseURL = agent.baseURL;
      }
      model = new OpenAIEmbeddings({
        model: String(modelName),
        apiKey: String(agent.apiKey ?? ''),
        ...(Object.keys(configuration).length ? { configuration } : {}),
      });
      break;
    }
    default:
      throw new Error(`Unsupported agent type: ${agent.type}`);
    }

    return model;
  };
}