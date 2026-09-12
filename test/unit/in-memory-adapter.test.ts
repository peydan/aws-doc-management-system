import {
  isMockStorageEnabled,
  isMockAuthEnabled,
  resetInMemoryStores,
  InMemoryStorageAdapter,
} from '../../src/shared/adapters/in-memory-storage';

describe('InMemoryStorageAdapter & Production Safety Ratchet', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetInMemoryStores();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('isMockStorageEnabled returns false when MOCK_STORAGE_BYPASS is not set', () => {
    delete process.env.MOCK_STORAGE_BYPASS;
    expect(isMockStorageEnabled()).toBe(false);
  });

  test('isMockStorageEnabled returns true when MOCK_STORAGE_BYPASS=true and not production', () => {
    process.env.MOCK_STORAGE_BYPASS = 'true';
    process.env.NODE_ENV = 'test';
    expect(isMockStorageEnabled()).toBe(true);
  });

  test('isMockStorageEnabled throws fatal security error when NODE_ENV=production', () => {
    process.env.MOCK_STORAGE_BYPASS = 'true';
    process.env.NODE_ENV = 'production';
    expect(() => isMockStorageEnabled()).toThrow(/FATAL SECURITY VIOLATION/);
  });

  test('isMockAuthEnabled throws fatal security error when NODE_ENV=production', () => {
    process.env.MOCK_AUTH_BYPASS = 'true';
    process.env.NODE_ENV = 'production';
    expect(() => isMockAuthEnabled()).toThrow(/FATAL SECURITY VIOLATION/);
  });

  test('isMockAuthEnabled returns true when MOCK_AUTH_BYPASS=true in dev/test', () => {
    process.env.MOCK_AUTH_BYPASS = 'true';
    process.env.NODE_ENV = 'development';
    expect(isMockAuthEnabled()).toBe(true);
  });

  test('InMemoryStorageAdapter can store and retrieve S3 objects and annotations', () => {
    const key = 'test/doc1.pdf';
    const body = Buffer.from('hello world', 'utf-8');
    const putRes = InMemoryStorageAdapter.putObject(key, body, 'application/pdf');
    expect(putRes.versionId).toBeDefined();

    const getRes = InMemoryStorageAdapter.getObjectBuffer(key, putRes.versionId);
    expect(getRes.body.toString('utf-8')).toBe('hello world');

    InMemoryStorageAdapter.putAnnotation(key, 'loan_agreement', 'doc-1', putRes.versionId, { foo: 'bar' }, 'document-metadata');
    const anno = InMemoryStorageAdapter.getAnnotation(key, 'loan_agreement', 'doc-1', putRes.versionId);
    expect(anno.metadata).toEqual({ foo: 'bar' });
  });

  test('resetInMemoryStores clears stored data', () => {
    const key = 'test/doc-clear.pdf';
    InMemoryStorageAdapter.putObject(key, Buffer.from('data'), 'application/pdf');
    resetInMemoryStores();

    // After reset, querying default returns the fallback dummy
    const res = InMemoryStorageAdapter.getObjectBuffer(key, 'nonexistent');
    expect(res.body.toString('utf-8')).toContain('%PDF-1.4');
  });
});
