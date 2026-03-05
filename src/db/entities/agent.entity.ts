import { AgentTypeEnum } from '@/types/agent/enums/agent-type.enum';

import { Entity, Column, DeleteDateColumn, CreateDateColumn, UpdateDateColumn, PrimaryGeneratedColumn } from 'typeorm';

/** Агент */
@Entity({
  name: 'agent',
})
export class AgentEntity {
  /** Уникальный идентификатор. Не может быть изменен. */
  @PrimaryGeneratedColumn()
  public id: number;

  /** Дата и время создания */
  @CreateDateColumn({
    type: 'timestamp with time zone',
    nullable: false,
  })
  public created: Date;

  /** Дата и время последнего обновления */
  @UpdateDateColumn({
    type: 'timestamp with time zone',
    nullable: false,
  })
  public updated: Date;

  /** Дата и время мягкого удаления */
  @DeleteDateColumn({
    type: 'timestamp with time zone',
    nullable: true,
  })
  public deleted: Date;

  /** Название агента */
  @Column('character varying', {
    nullable: false,
  })
  public name: string;

  /** Название модели агента */
  @Column('character varying', {
    nullable: true,
  })
  public model?: string;

  /** Тип агента */
  @Column('enum', {
    nullable: false,
    enum: AgentTypeEnum,
    enumName: 'agent_type_enum',
  })
  public type: AgentTypeEnum;

  /** Промпт агента */
  @Column('text', {
    nullable: false,
  })
  public prompt: string;

  /** Точность ответов (диапазон от 0.0 до 1.0) */
  @Column('numeric', {
    nullable: false,
    default: 0.7,
  })
  public temperature: number;

  /** Минимальная надежность ответов (диапазон от 0.0 до 1.0) */
  @Column('numeric', {
    nullable: false,
    name: 'min_confidence',
    default: 0.7,
  })
  public minConfidence: number;

  /** Активный агент */
  @Column('boolean', {
    nullable: false,
    default: true,
    name: 'is_active',
  })
  public isActive: boolean;

  /** Агент имеет функцию Embedding */
  @Column('boolean', {
    nullable: false,
    default: false,
    name: 'is_embedding',
  })
  public isEmbedding: boolean;

  /** API ключ агента */
  @Column('character varying', {
    nullable: false,
    name: 'api_key',
  })
  public apiKey: string;

  /** ID папки агента */
  @Column('character varying', {
    nullable: true,
    name: 'folder_id',
  })
  public folderID?: string;

  /** Базовый URL агента */
  @Column('character varying', {
    nullable: true,
    name: 'base_url',
  })
  public baseURL?: string;
}
