import type { MigrationInterface, QueryRunner } from 'typeorm';

const SCHEMA = 'amber_bot';

export class InitialSchema1730736000000 implements MigrationInterface {
  name = 'InitialSchema1730736000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await queryRunner.query(`
      CREATE TYPE "${SCHEMA}"."agent_type_enum" AS ENUM ('MISTRAL', 'OPENAI')
    `);
    await queryRunner.query(`
      CREATE TYPE "${SCHEMA}"."telegram_dialog_state_enum" AS ENUM (
        'IDLE',
        'ADMIN_UPLOAD_WAIT_TITLE',
        'ADMIN_UPLOAD_WAIT_TEXT',
        'ADMIN_UPLOAD_WAIT_FILES',
        'USER_CLARIFICATION_WAITING',
        'PROFILE_WAIT_MODEL',
        'PROFILE_WAIT_YEAR',
        'PROFILE_WAIT_MILEAGE',
        'FEEDBACK_WAIT_CORRECTION'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "${SCHEMA}"."user" (
        "id" SERIAL NOT NULL,
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted" TIMESTAMP,
        "telegram_id" character varying NOT NULL,
        "username" character varying,
        "first_name" character varying,
        "last_name" character varying,
        "phone" character varying,
        "car_model" character varying,
        "car_year" integer,
        "car_mileage" integer,
        "admin" boolean NOT NULL DEFAULT false,
        CONSTRAINT "UQ_user_telegram_id" UNIQUE ("telegram_id"),
        CONSTRAINT "PK_user" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "${SCHEMA}"."file" (
        "id" SERIAL NOT NULL,
        "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "original_name" character varying NOT NULL,
        "mime" character varying NOT NULL,
        "size" bigint NOT NULL,
        "storage_key" character varying NOT NULL,
        "public_url" character varying,
        "image_width" integer,
        "image_height" integer,
        CONSTRAINT "PK_file" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "${SCHEMA}"."agent" (
        "id" SERIAL NOT NULL,
        "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted" TIMESTAMP WITH TIME ZONE,
        "name" character varying NOT NULL,
        "model" character varying,
        "type" "${SCHEMA}"."agent_type_enum" NOT NULL,
        "prompt" text NOT NULL,
        "temperature" numeric NOT NULL DEFAULT 0.7,
        "min_confidence" numeric NOT NULL DEFAULT 0.7,
        "is_active" boolean NOT NULL DEFAULT true,
        "is_embedding" boolean NOT NULL DEFAULT false,
        "api_key" character varying NOT NULL,
        "folder_id" character varying,
        "base_url" character varying,
        CONSTRAINT "PK_agent" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "${SCHEMA}"."telegram_dialog_state" (
        "id" SERIAL NOT NULL,
        "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "telegram_id" character varying NOT NULL,
        "state" "${SCHEMA}"."telegram_dialog_state_enum" NOT NULL DEFAULT 'IDLE',
        "data" jsonb,
        CONSTRAINT "UQ_telegram_dialog_state_telegram_id" UNIQUE ("telegram_id"),
        CONSTRAINT "PK_telegram_dialog_state" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "${SCHEMA}"."knowledge_base" (
        "id" SERIAL NOT NULL,
        "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted" TIMESTAMP WITH TIME ZONE,
        "title" character varying NOT NULL,
        "content" text NOT NULL,
        "embedding_1536" vector(1536),
        "embedding_1024" vector(1024),
        "embedding_256" vector(256),
        "content_hash" character varying NOT NULL,
        CONSTRAINT "PK_knowledge_base" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_knowledge_base_deleted" ON "${SCHEMA}"."knowledge_base" ("deleted")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_knowledge_base_embedding_1536_hnsw"
      ON "${SCHEMA}"."knowledge_base" USING hnsw ("embedding_1536" vector_cosine_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_knowledge_base_embedding_1024_hnsw"
      ON "${SCHEMA}"."knowledge_base" USING hnsw ("embedding_1024" vector_cosine_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_knowledge_base_embedding_256_hnsw"
      ON "${SCHEMA}"."knowledge_base" USING hnsw ("embedding_256" vector_cosine_ops)
    `);

    await queryRunner.query(`
      CREATE TABLE "${SCHEMA}"."knowledge_base_file" (
        "knowledge_base_id" integer NOT NULL,
        "file_id" integer NOT NULL,
        CONSTRAINT "PK_knowledge_base_file" PRIMARY KEY ("knowledge_base_id", "file_id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "${SCHEMA}"."knowledge_base_file"
        ADD CONSTRAINT "FK_knowledge_base_file_knowledge_base_id"
        FOREIGN KEY ("knowledge_base_id") REFERENCES "${SCHEMA}"."knowledge_base"("id") ON UPDATE CASCADE ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "${SCHEMA}"."knowledge_base_file"
        ADD CONSTRAINT "FK_knowledge_base_file_file_id"
        FOREIGN KEY ("file_id") REFERENCES "${SCHEMA}"."file"("id") ON UPDATE CASCADE ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_knowledge_base_file_knowledge_base_id"
      ON "${SCHEMA}"."knowledge_base_file" ("knowledge_base_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_knowledge_base_file_file_id"
      ON "${SCHEMA}"."knowledge_base_file" ("file_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "${SCHEMA}"."response_history" (
        "id" SERIAL NOT NULL,
        "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "user_id" integer,
        "question" text NOT NULL,
        "response" text NOT NULL,
        "confidence" double precision,
        "knowledge_ids" integer array,
        "rating" character varying,
        "correction" text,
        "response_time_ms" integer,
        CONSTRAINT "PK_response_history" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "${SCHEMA}"."response_history"
        ADD CONSTRAINT "FK_response_history_user_id"
        FOREIGN KEY ("user_id") REFERENCES "${SCHEMA}"."user"("id") ON UPDATE CASCADE ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_response_history_user_id" ON "${SCHEMA}"."response_history" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_response_history_created" ON "${SCHEMA}"."response_history" ("created")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agent_is_active_is_embedding" ON "${SCHEMA}"."agent" ("is_active", "is_embedding")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_deleted" ON "${SCHEMA}"."agent" ("deleted")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_file_storage_key" ON "${SCHEMA}"."file" ("storage_key")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_user_deleted" ON "${SCHEMA}"."user" ("deleted")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "${SCHEMA}"."IDX_user_deleted"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "${SCHEMA}"."IDX_file_storage_key"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "${SCHEMA}"."IDX_agent_deleted"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "${SCHEMA}"."IDX_agent_is_active_is_embedding"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "${SCHEMA}"."IDX_response_history_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "${SCHEMA}"."IDX_response_history_user_id"`);
    await queryRunner.query(`ALTER TABLE "${SCHEMA}"."response_history" DROP CONSTRAINT IF EXISTS "FK_response_history_user_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "${SCHEMA}"."response_history"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "${SCHEMA}"."IDX_knowledge_base_embedding_256_hnsw"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "${SCHEMA}"."IDX_knowledge_base_embedding_1024_hnsw"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "${SCHEMA}"."IDX_knowledge_base_embedding_1536_hnsw"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "${SCHEMA}"."IDX_knowledge_base_deleted"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "${SCHEMA}"."IDX_knowledge_base_file_file_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "${SCHEMA}"."IDX_knowledge_base_file_knowledge_base_id"`);
    await queryRunner.query(`ALTER TABLE "${SCHEMA}"."knowledge_base_file" DROP CONSTRAINT IF EXISTS "FK_knowledge_base_file_file_id"`);
    await queryRunner.query(`ALTER TABLE "${SCHEMA}"."knowledge_base_file" DROP CONSTRAINT IF EXISTS "FK_knowledge_base_file_knowledge_base_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "${SCHEMA}"."knowledge_base_file"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "${SCHEMA}"."knowledge_base"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "${SCHEMA}"."telegram_dialog_state"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "${SCHEMA}"."agent"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "${SCHEMA}"."file"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "${SCHEMA}"."user"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "${SCHEMA}"."telegram_dialog_state_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "${SCHEMA}"."agent_type_enum"`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}"`);
  }
}
