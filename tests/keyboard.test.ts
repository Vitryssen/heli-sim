import { expect, test } from 'vitest';
import { isTyping } from '../src/input/keyboard';

const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, ...extra }) as unknown as EventTarget;

test('keys typed into text fields are text, not flight controls', () => {
  expect(isTyping(el('INPUT', { type: 'text' }))).toBe(true);       // pilot name, room code
  expect(isTyping(el('INPUT', { type: 'search' }))).toBe(true);
  expect(isTyping(el('TEXTAREA'))).toBe(true);
  expect(isTyping(el('DIV', { isContentEditable: true }))).toBe(true);
});

test('checkboxes, sliders, buttons and the game view still fly the aircraft', () => {
  expect(isTyping(el('INPUT', { type: 'checkbox' }))).toBe(false);
  expect(isTyping(el('INPUT', { type: 'range' }))).toBe(false);
  expect(isTyping(el('BUTTON'))).toBe(false);
  expect(isTyping(el('CANVAS'))).toBe(false);
  expect(isTyping(null)).toBe(false);
});
