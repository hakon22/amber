import { ModelBaseService } from '@/services/model/model-base.service';
import type { AgentEntity } from '@/db/entities/agent.entity';
import type { KnowledgeBaseEntity } from '@/db/entities/knowledge-base.entity';

import {  Singleton } from 'typescript-ioc';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

@Singleton
export class ModelExcerptService extends ModelBaseService {

  public getExcerpt = async (agent: AgentEntity, knowledges: KnowledgeBaseEntity[], prompt: string): Promise<string> => {
    const model = this.getChatModel(agent);

    const messages = [
      new SystemMessage(prompt),
      new HumanMessage([
        '=== КОНТЕНТ БАЗЫ ЗНАНИЙ НАЧАЛО ===',
        knowledges.map(({ content }) => content).join(', ').trim(),
        '=== КОНТЕНТ БАЗЫ ЗНАНИЙ КОНЕЦ ===',
      ].join('\n')),
    ];

    const response = await model.invoke(messages);
    return response.text?.trim();
  };
}
