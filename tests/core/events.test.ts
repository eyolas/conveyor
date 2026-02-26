import { assertEquals } from '@std/assert';
import { EventBus } from '@conveyor/core';

Deno.test('EventBus emits events to handlers', () => {
  const bus = new EventBus();
  const received: unknown[] = [];

  bus.on('waiting', (data) => received.push(data));
  bus.emit('waiting', { id: '1' });

  assertEquals(received.length, 1);
  assertEquals(received[0], { id: '1' });
});

Deno.test('EventBus off removes handler', () => {
  const bus = new EventBus();
  const received: unknown[] = [];

  const handler = (data: unknown) => received.push(data);
  bus.on('waiting', handler);
  bus.off('waiting', handler);
  bus.emit('waiting', { id: '1' });

  assertEquals(received.length, 0);
});

Deno.test('EventBus removeAllListeners clears all', () => {
  const bus = new EventBus();
  const received: unknown[] = [];

  bus.on('waiting', (data) => received.push(data));
  bus.on('active', (data) => received.push(data));
  bus.removeAllListeners();

  bus.emit('waiting', 1);
  bus.emit('active', 2);

  assertEquals(received.length, 0);
});

Deno.test('EventBus handler error emits on error channel', () => {
  const bus = new EventBus();
  const errors: unknown[] = [];

  bus.on('error', (err) => errors.push(err));
  bus.on('waiting', () => {
    throw new Error('handler boom');
  });

  bus.emit('waiting', {});

  assertEquals(errors.length, 1);
  assertEquals((errors[0] as Error).message, 'handler boom');
});

Deno.test('EventBus recursion guard prevents infinite loop on error handler throw', () => {
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
    assertEquals(consoleErrors.length, 1);
  } finally {
    console.error = originalError;
  }
});

Deno.test('EventBus removeAllListeners by event', () => {
  const bus = new EventBus();
  const received: unknown[] = [];

  bus.on('waiting', (data) => received.push(data));
  bus.on('active', (data) => received.push(data));
  bus.removeAllListeners('waiting');

  bus.emit('waiting', 1);
  bus.emit('active', 2);

  assertEquals(received.length, 1);
  assertEquals(received[0], 2);
});
