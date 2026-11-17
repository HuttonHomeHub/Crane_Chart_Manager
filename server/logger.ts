import { createLogger } from '@hhh/server';
import { config } from './config.ts';

// The one structured logger, from the shared kit (silent under test). Request logs come
// from the kit's httpLogger in createBaseApp: one small line per request, no headers.
export const logger = createLogger({ level: config.logLevel, name: 'crane-charts' });
