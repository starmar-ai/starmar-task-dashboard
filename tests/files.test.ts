import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_FILE_BYTES, formatBytes, normalizeUrl, safeFileName, storagePath } from '../src/lib/files.ts'

test('the per-file limit is 5 MB', () => {
  assert.equal(MAX_FILE_BYTES, 5_242_880)
})

test('normalizeUrl accepts web links and adds https when missing', () => {
  assert.equal(normalizeUrl('https://drive.google.com/file/d/abc'), 'https://drive.google.com/file/d/abc')
  assert.equal(normalizeUrl('  drive.google.com/x  '), 'https://drive.google.com/x')
  assert.equal(normalizeUrl('http://example.com'), 'http://example.com/')
})

test('normalizeUrl rejects non-web links and junk', () => {
  assert.equal(normalizeUrl('javascript:alert(1)'), null)
  assert.equal(normalizeUrl('mailto:a@b.com'), null)
  assert.equal(normalizeUrl('hello'), null)
  assert.equal(normalizeUrl('two words.com'), null)
  assert.equal(normalizeUrl(''), null)
})

test('safeFileName keeps the extension and drops unsafe characters', () => {
  assert.equal(safeFileName('Brief Klien (final) #2.pdf'), 'Brief-Klien-final-2.pdf')
  assert.equal(safeFileName('Résumé.docx'), 'Resume.docx')
  assert.equal(safeFileName('???.png'), 'file.png')
  assert.equal(safeFileName('README'), 'README')
})

test('storagePath starts with the task id so access rules can find the task', () => {
  assert.equal(storagePath('task-1', 'a b.pdf', 'n1'), 'task-1/n1/a-b.pdf')
})

test('formatBytes uses the UI locale', () => {
  assert.equal(formatBytes(512, 'en'), '512 B')
  assert.equal(formatBytes(1536 * 1024, 'id'), '1,5 MB')
  assert.equal(formatBytes(1024 ** 3, 'en'), '1 GB')
})
