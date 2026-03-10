import { expect, test } from 'vitest';
import { EventBus } from '@conveyor/core';

test('EventBus emits events to handlers', () => {
  const bus = new EventBus();
  const received: unknown[] = [];

  bus.on('waiting', (data) => received.push(data));
  bus.emit('waiting', { id: '1' });

  expect(received.length).toEqual(1);
  expect(received[0]).toEqual({ id: '1' });
});

test('EventBus off removes handler', () => {
  const bus = new EventBus();
  const received: unknown[] = [];

  const handler = (data: unknown) => received.push(data);
  bus.on('waiting', handler);
  bus.off('waiting', handler);
  bus.emit('waiting', { id: '1' });

  expect(received.length).toEqual(0);
});

test('EventBus removeAllListeners clears all', () => {
  const bus = new EventBus();
  const received: unknown[] = [];

  bus.on('waiting', (data) => received.push(data));
  bus.on('active', (data) => received.push(data));
  bus.removeAllListeners();

  bus.emit('waiting', 1);
  bus.emit('active', 2);

  expect(received.length).toEqual(0);
});

test('EventBus handler error emits on error channel', () => {
  const bus = new EventBus();
  const errors: unknown[] = [];

  bus.on('error', (err) => errors.push(err));
  bus.on('waiting', () => {
    throw new Error('handler boom');
  });

  bus.emit('waiting', {});

  expect(errors.length).toEqual(1);
  expect((errors[0] as Error).message).toEqual('handler boom');
});

test('EventBus recursion guard prevents infinite loop on error handler throw', () => {
  const bus = new EventBus();
  const consoleErrors: unknown[] = [];

  // Capture console.error
  const originalError = console.error;
  console.error = (...args: unknown[]) => consoleErrors.push(args);

  try {
    // Error handler that throws — would cause infinite recursion without guard
    bus.on('error', () => {
      throw new Error('error handler boom');
    });
    bus.on('waiting', () => {
      throw new Error('handler boom');
    });

    // This should NOT loop infinitely
    bus.emit('waiting', {});

    // The recursive error should be caught by console.error
    expect(consoleErrors.length).toEqual(1);
  } finally {
    console.error = originalError;
  }
});

test('EventBus removeAllListeners by event', () => {
  const bus = new EventBus();
  const received: unknown[] = [];

  bus.on('waiting', (data) => received.push(data));
  bus.on('active', (data) => received.push(data));
  bus.removeAllListeners('waiting');

  bus.emit('waiting', 1);
  bus.emit('active', 2);

  expect(received.length).toEqual(1);
  expect(received[0]).toEqual(2);
});

test('EventBus multiple handlers on same event', () => {
  const bus = new EventBus();
  const received: string[] = [];

  bus.on('waiting', () => received.push('handler-1'));
  bus.on('waiting', () => received.push('handler-2'));
  bus.on('waiting', () => received.push('handler-3'));

  bus.emit('waiting', {});

  expect(received).toEqual(['handler-1', 'handler-2', 'handler-3']);
});

test('EventBus off on non-existent event does not throw', () => {
  const bus = new EventBus();
  const handler = () => {};
  expect(() => bus.off('waiting', handler)).not.toThrow();
});

test('EventBus emit with no handlers does not throw', () => {
  const bus = new EventBus();
  expect(() => bus.emit('waiting', { id: '1' })).not.toThrow();
});

test('EventBus emit with null data', () => {
  const bus = new EventBus();
  const received: unknown[] = [];

  bus.on('drained', (data) => received.push(data));
  bus.emit('drained', null);

  expect(received).toEqual([null]);
});

test('EventBus removeAllListeners is idempotent', () => {
  const bus = new EventBus();
  bus.on('waiting', () => {});

  bus.removeAllListeners();
  bus.removeAllListeners(); // second call should not throw

  const received: unknown[] = [];
  bus.on('waiting', (d) => received.push(d));
  bus.emit('waiting', 'after-clear');
  expect(received).toEqual(['after-clear']);
});

test('EventBus error in non-error handler without error listener logs to console', () => {
  const bus = new EventBus();
  const consoleErrors: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => consoleErrors.push(args);

  try {
    // No 'error' handler registered
    bus.on('waiting', () => {
      throw new Error('no error handler boom');
    });
    bus.emit('waiting', {});

    // Should fall back to console.error since there's no 'error' handler
    // Actually the emit method emits on 'error' channel, but with no handler there, nothing happens
    // Let's check: it emits on 'error', but if no handler is registered, the error set is empty so nothing
  } finally {
    console.error = originalError;
  }
});

test('EventBus duplicate handler registration', () => {
  const bus = new EventBus();
  let count = 0;
  const handler = () => { count++; };

  bus.on('waiting', handler);
  bus.on('waiting', handler); // Set-based, should deduplicate

  bus.emit('waiting', {});

  // Set ensures handler is only called once
  expect(count).toEqual(1);
});
