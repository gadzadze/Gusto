import "server-only";
import { emailChannel } from "./email";
import { inAppChannel } from "./in-app";
import { pushChannel } from "./push";
import type { Channel } from "./types";

export type { Channel, ClaimedDelivery, DeliveryOutcome, NotificationDraft } from "./types";

/** Channels in the order `enqueue` runs them: in-app first, the outbox channels reference its row. */
export const channels: readonly Channel[] = [inAppChannel, emailChannel, pushChannel];
