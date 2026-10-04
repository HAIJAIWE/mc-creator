#!/usr/bin/env node
/**
 * MC Creator 协作信令中继（开发/局域网联调）。
 *
 * - 纯房间转发，不解析业务语义：同 docId 的消息原样转给房间内其他节点。
 * - 客户端连接：ws://<host>:<port>/?docId=<doc>&peerId=<peer>
 * - 文本消息按 UTF-8 转发；二进制直接关闭连接。
 *
 * 用法：
 *   node scripts/collab-relay.mjs --port 8787 --host 127.0.0.1
 * 客户端在协作面板填入 ws://<host>:8787 后点连接。
 */
import { WebSocketServer } from 'ws';

function parseArgs(argv) {
  const out = { port: 8787, host: '127.0.0.1' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' && argv[i + 1]) out.port = Number(argv[++i]);
    else if (a === '--host' && argv[i + 1]) out.host = argv[++i];
  }
  return out;
}

const { port, host } = parseArgs(process.argv);

/** room: docId -> Set<ws> */
const rooms = new Map();

function roomOf(docId) {
  let set = rooms.get(docId);
  if (!set) {
    set = new Set();
    rooms.set(docId, set);
  }
  return set;
}

const wss = new WebSocketServer({ host, port });

wss.on('connection', (ws, req) => {
  let docId = 'default';
  let peerId = 'unknown';
  try {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`);
    docId = url.searchParams.get('docId') || 'default';
    peerId = url.searchParams.get('peerId') || 'unknown';
  } catch {
    /* 保持默认值 */
  }
  const room = roomOf(docId);
  room.add(ws);
  console.log(`[relay] join doc=${docId} peer=${peerId} (room=${room.size})`);

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      ws.close(1003, 'binary not supported');
      return;
    }
    const text = data.toString('utf8');
    for (const peer of room) {
      if (peer !== ws && peer.readyState === 1) {
        peer.send(text);
      }
    }
  });

  const leave = () => {
    room.delete(ws);
    if (room.size === 0) rooms.delete(docId);
    console.log(`[relay] leave doc=${docId} peer=${peerId} (room=${room.size})`);
  };
  ws.on('close', leave);
  ws.on('error', () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
});

wss.on('listening', () => {
  console.log(`[relay] listening on ws://${host}:${port}`);
});
