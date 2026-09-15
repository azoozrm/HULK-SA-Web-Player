import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browserCredentialPersistenceViolations,
  nonEmptySecretExampleViolations,
} from '../tools/repository-policy.mjs';

test('browser persistence guard rejects credential-capable browser stores', () => {
  assert.notEqual(browserCredentialPersistenceViolations('localStorage.setItem("x", "y")').length, 0);
  assert.notEqual(browserCredentialPersistenceViolations('sessionStorage.getItem("x")').length, 0);
  assert.notEqual(browserCredentialPersistenceViolations('indexedDB.open("x")').length, 0);
  assert.equal(browserCredentialPersistenceViolations('const state = new Map()').length, 0);
});

test('safe environment example permits empty secret placeholders only', () => {
  assert.deepEqual(nonEmptySecretExampleViolations('HULK_SESSION_ENCRYPTION_KEY='), []);
  assert.deepEqual(nonEmptySecretExampleViolations('HULK_SESSION_ENCRYPTION_KEY=real-secret'), [
    'HULK_SESSION_ENCRYPTION_KEY',
  ]);
});
