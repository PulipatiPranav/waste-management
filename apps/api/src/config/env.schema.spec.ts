import { envSchemaWithRules } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(48),
};

describe('env schema — DEMO_MODE', () => {
  it('defaults to off', () => {
    const env = envSchemaWithRules.parse(base);
    expect(env.DEMO_MODE).toBe(false);
  });

  it('is allowed outside production', () => {
    const env = envSchemaWithRules.parse({ ...base, NODE_ENV: 'development', DEMO_MODE: 'true' });
    expect(env.DEMO_MODE).toBe(true);
  });

  it('is refused in production', () => {
    const result = envSchemaWithRules.safeParse({
      ...base,
      NODE_ENV: 'production',
      DEMO_MODE: 'true',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain('DEMO_MODE');
  });
});
