import { Entity, CreateDateColumn, Column, DeleteDateColumn, UpdateDateColumn, PrimaryGeneratedColumn, BaseEntity, ManyToMany, JoinTable } from 'typeorm';
import { FileEntity } from '@/db/entities/file.entity';

/** Трансформер для колонок pgvector: в БД передаётся строка формата "[0.1, 0.2, ...]" */
const vectorTransformer = {
  to: (value: number[] | null | undefined): string | null => {
    if (value == null || !Array.isArray(value) || value.length === 0) {
      return null;
    }
    return `[${value.join(',')}]`;
  },
  from: (value: string | number[] | null | undefined): number[] => {
    if (value == null) {
      return [];
    }
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value !== 'string' || !value.startsWith('[') || !value.endsWith(']')) {
      return [];
    }
    return value
      .slice(1, -1)
      .split(',')
      .map((s) => Number.parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n));
  },
};

/** База знаний */
@Entity({
  name: 'knowledge_base',
})
export class KnowledgeBaseEntity extends BaseEntity {
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

  /** Название базы знаний */
  @Column('character varying', {
    nullable: false,
  })
  public title: string;

  /** Контент базы знаний */
  @Column('text', {
    nullable: false,
  })
  public content: string;

  /** Embedding с 1536 длиной (pgvector). Индекс для поиска — IVFFlat/HNSW, создаётся миграцией. */
  @Column('varchar', {
    nullable: true,
    name: 'embedding_1536',
    transformer: vectorTransformer,
  })
  public embedding1536: number[];

  /** Embedding с 1024 длиной (pgvector). Индекс для поиска — IVFFlat/HNSW, создаётся миграцией. */
  @Column('varchar', {
    nullable: true,
    name: 'embedding_1024',
    transformer: vectorTransformer,
  })
  public embedding1024: number[];

  /** Embedding с 256 длиной (pgvector). Индекс для поиска — IVFFlat/HNSW, создаётся миграцией. */
  @Column('varchar', {
    nullable: true,
    name: 'embedding_256',
    transformer: vectorTransformer,
  })
  public embedding256: number[];

  /** Файлы знания (many-to-many через таблицу knowledge_base_file) */
  @ManyToMany(() => FileEntity)
  @JoinTable({
    name: 'knowledge_base_file',
    joinColumn: {
      name: 'knowledge_base_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'file_id',
      referencedColumnName: 'id',
    },
  })
  public files?: FileEntity[];

  /** Хеш контента базы знаний */
  @Column('character varying', {
    nullable: false,
    name: 'content_hash',
  })
  public contentHash: string;
}
