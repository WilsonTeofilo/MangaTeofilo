import test from 'node:test';
import assert from 'node:assert/strict';
import { panelRoleFromAdminContext } from './claimsConsistency.js';

test('panelRoleFromAdminContext alinha com adminGetMyAdminProfile (mangaka antes de super)', () => {
  assert.equal(panelRoleFromAdminContext({ super: true, mangaka: true }), 'mangaka');
});

test('panelRoleFromAdminContext: super_admin', () => {
  assert.equal(panelRoleFromAdminContext({ super: true, mangaka: false }), 'super_admin');
});

test('panelRoleFromAdminContext: admin de registry', () => {
  assert.equal(panelRoleFromAdminContext({ super: false, mangaka: false }), 'admin');
});

test('panelRoleFromAdminContext: null sem ctx', () => {
  assert.equal(panelRoleFromAdminContext(null), null);
});
