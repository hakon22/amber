import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, BaseEntity } from 'typeorm';

/** Пользователь Telegram-бота */
@Entity({
  name: 'user',
})
export class UserEntity extends BaseEntity {
  /** Уникальный `id` пользователя */
  @PrimaryGeneratedColumn()
  public id: number;

  /** Дата создания пользователя */
  @CreateDateColumn()
  public created: Date;

  /** Дата изменения пользователя */
  @UpdateDateColumn()
  public updated: Date;

  /** Дата удаления пользователя */
  @DeleteDateColumn()
  public deleted: Date | null;

  /** Telegram id пользователя (обязателен, уникален) */
  @Column('character varying', {
    name: 'telegram_id',
    unique: true,
  })
  public telegramId: string;

  /** Username пользователя в Telegram */
  @Column('character varying', {
    nullable: true,
  })
  public username: string | null;

  /** Имя пользователя */
  @Column('character varying', {
    name: 'first_name',
    nullable: true,
  })
  public firstName: string | null;

  /** Фамилия пользователя */
  @Column('character varying', {
    name: 'last_name',
    nullable: true,
  })
  public lastName: string | null;

  /** Телефон пользователя (если будет получен) */
  @Column('character varying', {
    nullable: true,
  })
  public phone: string | null;

  /** Модель автомобиля пользователя */
  @Column('character varying', {
    name: 'car_model',
    nullable: true,
  })
  public carModel: string | null;

  /** Год выпуска автомобиля пользователя */
  @Column('integer', {
    name: 'car_year',
    nullable: true,
  })
  public carYear: number | null;

  /** Пробег автомобиля пользователя */
  @Column('integer', {
    name: 'car_mileage',
    nullable: true,
  })
  public carMileage: number | null;

  /** Роль пользователя (для админ-доступа) */
  @Column('boolean', {
    default: false,
  })
  public admin: boolean;
}
