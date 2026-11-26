import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = await readFile(new URL('../src/relay-worker.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { PinxRoom } = await import(moduleUrl);

function createRoom() {
    const values = new Map();
    const storage = {
        get: async key => values.get(key),
        put: async (key, value) => values.set(key, value),
        delete: async key => values.delete(key)
    };
    const room = new PinxRoom({ storage }, { ALLOWED_ORIGIN: 'https://punxcore058.github.io' });
    const fetch = (path, method, body, headers = {}) => room.fetch(new Request(
        `https://relay.test/internal/${path}`,
        { method, body, headers }
    ));
    return { fetch };
}

test('requires a registered device key and rejects key replacement', async () => {
    const room = createRoom();
    const key = 'a'.repeat(43);
    assert.equal((await room.fetch('device/register', 'POST', key)).status, 204);
    assert.equal((await room.fetch('device/register', 'POST', 'b'.repeat(43))).status, 409);
    assert.equal((await room.fetch('device/register', 'POST', 'short')).status, 400);
});

test('pairs with PIN 123456 and relays packets in both directions', async () => {
    const room = createRoom();
    const key = 'a'.repeat(43);
    assert.equal((await room.fetch('device/register', 'POST', key)).status, 204);
    assert.equal((await room.fetch('pair', 'POST', '000000')).status, 401);
    assert.equal((await room.fetch('pair', 'POST', '123456')).status, 204);

    const deviceHeaders = { 'X-PINX-Device-Key': key, 'Content-Type': 'application/json' };
    const sentPacket = JSON.stringify({ digits: '123', result: '6', digitDelay: 1 });
    assert.equal((await room.fetch('device/poll', 'POST',
        JSON.stringify({ packet: sentPacket, digitDelay: 2 }), deviceHeaders)).status, 200);

    const digits = await room.fetch('digits', 'GET');
    assert.equal(digits.status, 200);
    assert.equal(await digits.text(), sentPacket);
    assert.equal(digits.headers.get('X-PINX-Digit-Delay'), '2');

    assert.equal((await room.fetch('send', 'POST', '!5')).status, 204);
    const command = await room.fetch('device/poll', 'POST',
        JSON.stringify({ packet: '', digitDelay: 2 }), deviceHeaders);
    assert.equal(await command.text(), '!5');
});

test('locks pairing after five invalid PIN attempts', async () => {
    const room = createRoom();
    for (let attempt = 0; attempt < 5; attempt++) {
        assert.equal((await room.fetch('pair', 'POST', '000000')).status, 401);
    }
    assert.equal((await room.fetch('pair', 'POST', '123456')).status, 429);
});

test('rejects browser access while the relay device is offline', async () => {
    const room = createRoom();
    assert.equal((await room.fetch('pair', 'POST', '123456')).status, 204);
    assert.equal((await room.fetch('digits', 'GET')).status, 503);
});
