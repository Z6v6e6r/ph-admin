// Produces synthetic output by invoking the actual service, without DB/provider access.
import { writeFileSync } from 'node:fs';
import { emitNotificationWire } from './tournament-chat-notification.fixture';
const target = process.argv[2];
if (!target) throw new Error('SYNTHETIC_NOTIFICATION_WIRE_TARGET_REQUIRED');
void emitNotificationWire().then(value => writeFileSync(target, JSON.stringify(value, null, 2) + '\n'));
