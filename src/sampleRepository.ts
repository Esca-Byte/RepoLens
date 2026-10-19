import type { Language, RepositoryFile } from './types';

const sourceFiles: Array<{ path: string; content: string }> = [
  {
    path: 'package.json',
    content: `{
  "name": "payments-api",
  "main": "src/server.ts",
  "scripts": { "dev": "tsx src/server.ts", "test": "vitest" },
  "dependencies": { "stripe": "^16.0.0", "pg": "^8.0.0" }
}`,
  },
  {
    path: 'src/server.ts',
    content: `import { createRouter } from './api/routes';
import { loadConfig } from './shared/config';
import { createDatabase } from './data/db';

export async function startServer() {
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  const router = createRouter({ database, config });
  return router.listen(config.port);
}

startServer();
`,
  },
  {
    path: 'src/api/routes.ts',
    content: `import { createSession } from '../auth/session';
import { checkout } from '../payments/checkout';
import { listOrders } from '../data/orders';

export function createRouter(context: RouterContext) {
  return {
    getOrders: () => listOrders(context.database),
    checkout: (request: CheckoutRequest) => checkout(request, context),
    session: (token: string) => createSession(token),
    listen: (port: number) => ({ port, ready: true }),
  };
}
`,
  },
  {
    path: 'src/auth/session.ts',
    content: `import { getConfig } from '../shared/config';

export function createSession(token: string) {
  const config = getConfig();
  return { token, expiresIn: config.sessionTtl };
}

export function revokeSession(token: string) {
  return { token, revoked: true };
}
`,
  },
  {
    path: 'src/auth/index.ts',
    content: `export { createSession, revokeSession } from './session';
`,
  },
  {
    path: 'src/payments/checkout.ts',
    content: `import Stripe from 'stripe';
import { persistOrder } from '../data/orders';
import { getConfig } from '../shared/config';

export async function checkout(request: CheckoutRequest, context: CheckoutContext) {
  const payment = await createPayment(request.amount);
  return persistOrder(context.database, { ...request, payment });
}

async function createPayment(amount: number) {
  const stripe = new Stripe(getConfig().stripeKey);
  return stripe.paymentIntents.create({ amount, currency: 'usd' });
}
`,
  },
  {
    path: 'src/payments/gateway.ts',
    content: `import Stripe from 'stripe';
import { getConfig } from '../shared/config';

export function paymentGateway() {
  return new Stripe(getConfig().stripeKey);
}
`,
  },
  {
    path: 'src/data/orders.ts',
    content: `import type { Database } from './db';

export function listOrders(database: Database) {
  return database.query('select * from orders');
}

export function persistOrder(database: Database, order: Order) {
  return database.insert('orders', order);
}
`,
  },
  {
    path: 'src/data/db.ts',
    content: `import pg from 'pg';

export interface Database {
  query(sql: string): unknown[];
  insert(table: string, value: unknown): unknown;
}

export function createDatabase(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString });
  return { query: (sql) => pool.query(sql), insert: (table, value) => pool.query(table, value) };
}
`,
  },
  {
    path: 'src/shared/config.ts',
    content: `export interface AppConfig {
  port: number;
  stripeKey: string;
  databaseUrl: string;
  sessionTtl: number;
}

export function loadConfig(): AppConfig {
  return { port: 3000, stripeKey: 'local', databaseUrl: 'local', sessionTtl: 3600 };
}

export const getConfig = loadConfig;
`,
  },
  {
    path: 'tests/checkout.test.ts',
    content: `import { checkout } from '../src/payments/checkout';

describe('checkout', () => {
  it('persists a paid order', async () => {
    expect(await checkout({ amount: 1200 }, context)).toBeDefined();
  });
});
`,
  },
  {
    path: 'README.md',
    content: `# Payments API\n\nHTTP service for checkout and order history.\n`,
  },
];

export function languageForPath(path: string): Language {
  const extension = path.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'TypeScript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'JavaScript';
    case 'py':
      return 'Python';
    case 'go':
      return 'Go';
    case 'rs':
      return 'Rust';
    case 'java':
      return 'Java';
    case 'cs':
      return 'C#';
    case 'php':
      return 'PHP';
    case 'kt':
    case 'kts':
      return 'Kotlin';
    case 'swift':
      return 'Swift';
    case 'c':
    case 'h':
      return 'C';
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'hpp':
      return 'C++';
    case 'json':
      return 'JSON';
    case 'md':
      return 'Markdown';
    case 'css':
    case 'scss':
      return 'Stylesheet';
    default:
      return 'Unknown';
  }
}

export const sampleFiles: RepositoryFile[] = sourceFiles.map(({ path, content }) => ({
  path,
  content,
  language: languageForPath(path),
  size: content.length,
}));
