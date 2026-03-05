import { BaseEntity, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn, ManyToMany } from 'typeorm';

import { KnowledgeBaseEntity } from '@/db/entities/knowledge-base.entity';

@Entity({
  name: 'file',
})
export class FileEntity extends BaseEntity {
  @PrimaryGeneratedColumn()
  public id: number;

  @CreateDateColumn({
    type: 'timestamp with time zone',
    nullable: false,
  })
  public created: Date;

  @UpdateDateColumn({
    type: 'timestamp with time zone',
    nullable: false,
  })
  public updated: Date;

  @Column('character varying', {
    nullable: false,
    name: 'original_name',
  })
  public originalName: string;

  @Column('character varying', {
    nullable: false,
  })
  public mime: string;

  @Column('bigint', {
    nullable: false,
  })
  public size: number;

  @Column('character varying', {
    nullable: false,
    name: 'storage_key',
  })
  public storageKey: string;

  @Column('character varying', {
    nullable: true,
    name: 'public_url',
  })
  public publicUrl?: string | null;

  @Column('integer', {
    nullable: true,
    name: 'image_width',
  })
  public imageWidth?: number | null;

  @Column('integer', {
    nullable: true,
    name: 'image_height',
  })
  public imageHeight?: number | null;

  @ManyToMany(() => KnowledgeBaseEntity, (knowledgeBase) => knowledgeBase.files)
  public knowledges?: KnowledgeBaseEntity[];
}

