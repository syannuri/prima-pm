-- Webhook delivery format (T4.1): GENERIC signed JSON, or a Slack/Teams chat message.

CREATE TYPE "WebhookFormat" AS ENUM ('GENERIC', 'SLACK', 'TEAMS');

ALTER TABLE "WebhookSubscription" ADD COLUMN "format" "WebhookFormat" NOT NULL DEFAULT 'GENERIC';
