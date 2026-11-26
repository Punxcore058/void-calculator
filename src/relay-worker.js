const ROOM_PATH = /^\/api\/rooms\/([0-9a-f-]{36})\/(pair|digits|send|device\/register|device\/poll)$/i;
const MAX_PACKET_LENGTH = 600;
const ROOM_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-PINX-Device-Key',
        'Access-Control-Max-Age': '86400',
        'Cache-Control': 'no-store'
    };
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin');
        const allowedOrigin = env.ALLOWED_ORIGIN;
        if (origin && origin !== allowedOrigin) return new Response('Forbidden', { status: 403 });

        const headers = corsHeaders(allowedOrigin);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

        const url = new URL(request.url);
        const match = ROOM_PATH.exec(url.pathname);
        if (!match || !ROOM_ID_PATTERN.test(match[1])) {
            return new Response('Not found', { status: 404, headers });
        }

        if (!['GET', 'POST'].includes(request.method)) {
            return new Response('Method not allowed', { status: 405, headers });
        }

        const roomId = env.ROOMS.idFromName(match[1].toLowerCase());
        const room = env.ROOMS.get(roomId);
        const roomUrl = new URL(`/internal/${match[2]}`, url.origin);
        return room.fetch(new Request(roomUrl.toString(), request));
    }
};

export class PinxRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;
    }

    async fetch(request) {
        const headers = new Headers(corsHeaders(this.env.ALLOWED_ORIGIN));
        const path = new URL(request.url).pathname;
        const endpoint = path.slice('/internal/'.length);

        if (endpoint === 'device/register' && request.method === 'POST') {
            const secret = (await request.text()).trim();
            if (!/^[A-Za-z0-9_-]{40,64}$/.test(secret)) {
                return new Response('Invalid device key', { status: 400, headers });
            }
            const existing = await this.state.storage.get('deviceKey');
            if (existing && existing !== secret) {
                return new Response('Relay room already registered', { status: 409, headers });
            }
            await this.state.storage.put('deviceKey', secret);
            return new Response(null, { status: 204, headers });
        }

        if (endpoint === 'device/poll' && request.method === 'POST') {
            if (!await this.isDevice(request)) return new Response('Unauthorized', { status: 401, headers });
            let body;
            try {
                body = await request.json();
            } catch {
                return new Response('Invalid request body', { status: 400, headers });
            }
            const packet = typeof body.packet === 'string' ? body.packet : '';
            const delay = Number(body.digitDelay);
            if (packet.length > MAX_PACKET_LENGTH) return new Response('Packet too large', { status: 413, headers });

            await this.state.storage.put('lastSeen', Date.now());
            if (packet) await this.state.storage.put('phonePacket', packet);
            if (Number.isInteger(delay) && delay >= 1 && delay <= 4) {
                await this.state.storage.put('digitDelay', delay);
            }
            const command = await this.state.storage.get('browserCommand') || '';
            if (command) await this.state.storage.delete('browserCommand');
            return new Response(command, { status: 200, headers });
        }

        if (endpoint === 'pair' && request.method === 'POST') {
            const lockUntil = await this.state.storage.get('lockUntil') || 0;
            if (lockUntil > Date.now()) return new Response('Too many attempts', { status: 429, headers });

            const code = (await request.text()).trim();
            if (code !== '123456') {
                const attempts = (await this.state.storage.get('failedAttempts') || 0) + 1;
                await this.state.storage.put('failedAttempts', attempts);
                if (attempts >= 5) {
                    await this.state.storage.put('failedAttempts', 0);
                    await this.state.storage.put('lockUntil', Date.now() + 60_000);
                }
                return new Response('PIN rejected', { status: 401, headers });
            }

            await this.state.storage.put('failedAttempts', 0);
            await this.state.storage.put('paired', true);
            return new Response(null, { status: 204, headers });
        }

        if (endpoint === 'digits' && request.method === 'GET') {
            if (!await this.isPaired()) return new Response('Pair first', { status: 401, headers });
            const lastSeen = await this.state.storage.get('lastSeen') || 0;
            if (Date.now() - lastSeen > 5000) return new Response('PINX device is offline', { status: 503, headers });
            const packet = await this.state.storage.get('phonePacket') || '';
            await this.state.storage.delete('phonePacket');
            headers.set('X-PINX-Digit-Delay', String(await this.state.storage.get('digitDelay') || 1));
            headers.set('X-PINX-Connected', 'true');
            headers.set('Content-Type', 'text/plain; charset=utf-8');
            return new Response(packet, { status: 200, headers });
        }

        if (endpoint === 'send' && request.method === 'POST') {
            if (!await this.isPaired()) return new Response('Pair first', { status: 401, headers });
            const lastSeen = await this.state.storage.get('lastSeen') || 0;
            if (Date.now() - lastSeen > 5000) return new Response('PINX device is offline', { status: 503, headers });
            const command = (await request.text()).trim();
            if (!/^(?:!?[0-9]{1,16})$/.test(command)) {
                return new Response('Invalid calculator packet', { status: 400, headers });
            }
            await this.state.storage.put('browserCommand', command);
            return new Response(null, { status: 204, headers });
        }

        return new Response('Not found', { status: 404, headers });
    }

    async isPaired() {
        return (await this.state.storage.get('paired')) === true;
    }

    async isDevice(request) {
        const registeredKey = await this.state.storage.get('deviceKey');
        return Boolean(registeredKey) && request.headers.get('X-PINX-Device-Key') === registeredKey;
    }
}
