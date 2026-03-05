import { UserEntity } from '@/db/entities/user.entity';
import { KnowledgeBaseEntity } from '@/db/entities/knowledge-base.entity';
import { ResponseHistoryEntity } from '@/db/entities/response-history.entity';
import { AgentEntity } from '@/db/entities/agent.entity';
import { FileEntity } from '@/db/entities/file.entity';
import { TelegramDialogStateEntity } from '@/db/entities/telegram-dialog-state.entity';

export const entities = [
  UserEntity,
  KnowledgeBaseEntity,
  ResponseHistoryEntity,
  AgentEntity,
  FileEntity,
  TelegramDialogStateEntity,
];
