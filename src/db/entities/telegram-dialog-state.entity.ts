import { BaseEntity, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum TelegramDialogStateEnum {
  /** Состояние ожидания */
  IDLE = 'IDLE',
  /** Состояние ожидания заголовка */
  ADMIN_UPLOAD_WAIT_TITLE = 'ADMIN_UPLOAD_WAIT_TITLE',
  /** Состояние ожидания текста */
  ADMIN_UPLOAD_WAIT_TEXT = 'ADMIN_UPLOAD_WAIT_TEXT',
  /** Состояние ожидания файлов */
  ADMIN_UPLOAD_WAIT_FILES = 'ADMIN_UPLOAD_WAIT_FILES',
  /** Состояние ожидания уточнения */
  USER_CLARIFICATION_WAITING = 'USER_CLARIFICATION_WAITING',
  /** Состояние ожидания модели */
  PROFILE_WAIT_MODEL = 'PROFILE_WAIT_MODEL',
  /** Состояние ожидания года */
  PROFILE_WAIT_YEAR = 'PROFILE_WAIT_YEAR',
  /** Состояние ожидания пробега */
  PROFILE_WAIT_MILEAGE = 'PROFILE_WAIT_MILEAGE',
  /** Состояние ожидания коррекции */
  FEEDBACK_WAIT_CORRECTION = 'FEEDBACK_WAIT_CORRECTION',
}

@Entity({
  name: 'telegram_dialog_state',
})
export class TelegramDialogStateEntity extends BaseEntity {
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
    name: 'telegram_id',
    unique: true,
  })
  public telegramId: string;

  @Column('enum', {
    nullable: false,
    enum: TelegramDialogStateEnum,
    enumName: 'telegram_dialog_state_enum',
    default: TelegramDialogStateEnum.IDLE,
  })
  public state: TelegramDialogStateEnum;

  @Column('jsonb', {
    nullable: true,
  })
  public data?: Record<string, any> | null;
}

