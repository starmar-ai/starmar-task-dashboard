import test from 'node:test'
import assert from 'node:assert/strict'
import { shortcutFor, type KeyContext } from '../src/lib/shortcuts.ts'

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods })
const idle: KeyContext = { typing: false, overlayOpen: false, awaitingGo: false }

test('single keys map to actions', () => {
  assert.deepEqual(shortcutFor(key('?'), idle), { kind: 'help' })
  assert.deepEqual(shortcutFor(key('/'), idle), { kind: 'search' })
  assert.deepEqual(shortcutFor(key('n'), idle), { kind: 'newTask' })
  assert.deepEqual(shortcutFor(key('N'), idle), { kind: 'newTask' })
  assert.deepEqual(shortcutFor(key('t'), idle), { kind: 'toggleTheme' })
  assert.deepEqual(shortcutFor(key('g'), idle), { kind: 'startGo' })
  assert.equal(shortcutFor(key('x'), idle), null)
})

test('G then a letter goes to a page', () => {
  const ctx = { ...idle, awaitingGo: true }
  assert.deepEqual(shortcutFor(key('t'), ctx), { kind: 'go', path: '/tasks' })
  assert.deepEqual(shortcutFor(key('c'), ctx), { kind: 'go', path: '/calendar' })
  assert.deepEqual(shortcutFor(key('n'), ctx), { kind: 'go', path: '/notifications' })
  assert.equal(shortcutFor(key('z'), ctx), null)
})

test('nothing fires while typing, except Ctrl+K', () => {
  const ctx = { ...idle, typing: true }
  assert.equal(shortcutFor(key('n'), ctx), null)
  assert.equal(shortcutFor(key('/'), ctx), null)
  assert.equal(shortcutFor(key('?'), ctx), null)
  assert.deepEqual(shortcutFor(key('k', { ctrlKey: true }), ctx), { kind: 'search' })
  assert.deepEqual(shortcutFor(key('k', { metaKey: true }), ctx), { kind: 'search' })
})

test('an open dialog blocks every shortcut', () => {
  const ctx = { ...idle, overlayOpen: true }
  assert.equal(shortcutFor(key('n'), ctx), null)
  assert.equal(shortcutFor(key('k', { ctrlKey: true }), ctx), null)
})

test('browser combos and held keys are left alone', () => {
  assert.equal(shortcutFor(key('n', { ctrlKey: true }), idle), null)
  assert.equal(shortcutFor(key('t', { metaKey: true }), idle), null)
  assert.equal(shortcutFor(key('g', { altKey: true }), idle), null)
  assert.equal(shortcutFor(key('n', { repeat: true }), idle), null)
})
