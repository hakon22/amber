import { Entity, CreateDateColumn, Column, PrimaryGeneratedColumn, BaseEntity, ManyToOne, JoinColumn, Index } from 'typeorm';
import { UserEntity } from '@/db/entities/user.entity';

export type ResponseRating = 'USEFUL' | 'NOT_USEFUL';

/** История ответов */
@Entity({
  name: 'response_history',
})
export class ResponseHistoryEntity extends BaseEntity {
  /** Уникальный идентификатор. Не может быть изменен. */
  @PrimaryGeneratedColumn()
  public id: number;

  /** Дата и время создания */
  @CreateDateColumn({
    type: 'timestamp with time zone',
    nullable: false,
  })
  public created: Date;

  /** Пользователь */
  @Index()
  @ManyToOne(() => UserEntity, {
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({
    name: 'user_id',
  })
  public user?: UserEntity | null;

  /** Вопрос */
  @Column('text', {
    nullable: false,
  })
  public question: string;

  /** Ответ */
  @Column('text', {
    nullable: false,
  })
  public response: string;

  /** Уверенность в ответе (по векторному поиску) */
  @Column('double precision', {
    nullable: true,
  })
  public confidence: number;

  /** Использованные знания */
  @Column('integer', {
    array: true,
    nullable: true,
    name: 'knowledge_ids',
  })
  public knowledgeIds?: number[] | null;

  /** Оценка ответа пользователем */
  @Column('character varying', {
    nullable: true,
  })
  public rating?: ResponseRating | null;

  /** Исправленный/уточнённый ответ пользователя */
  @Column('text', {
    nullable: true,
  })
  public correction?: string | null;

  /** Время генерации ответа в миллисекундах */
  @Column('integer', {
    nullable: true,
    name: 'response_time_ms',
  })
  public responseTimeMs?: number | null;
}
