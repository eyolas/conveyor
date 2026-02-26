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
