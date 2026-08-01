// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServerPreviewPanel } from './ServerPreviewPanel.js';
import { useModStore } from '../../store/mod-store.js';

function resetStore(spec: unknown) {
  useModStore.setState({
    loader: 'fabric',
    mcVersion: '1.21.11',
    description: '',
    generatorType: 'server',
    spec: spec as never,
    files: [],
    previousFiles: [],
    selectedFile: null,
    openTabs: [],
    splitFile: null,
    dirtyFiles: new Set<string>(),
    buildLog: '',
    buildSuccess: null,
    jarPath: null,
    loading: false,
    error: null,
    fixLog: [],
  });
}

const BASE_SERVER = {
  serverName: 'My Server',
  mcVersion: '1.21.1',
  motd: 'Hello',
  maxPlayers: 20,
  port: 25565,
  gamemode: 'survival',
  difficulty: 'normal',
  levelName: 'world',
  pvp: true,
  onlineMode: true,
  whitelist: false,
  enforceWhitelist: false,
  viewDistance: 10,
  simulationDistance: 10,
  allowFlight: false,
  allowNether: true,
  allowEnd: true,
  spawnAnimals: true,
  spawnNpcs: true,
  spawnMonsters: true,
  generateStructures: true,
  ops: [],
  whitelistEntries: [],
  mods: [],
  extraProperties: {},
  eula: true,
  startMemory: '2G',
  maxMemory: '4G',
  deployTarget: 'none',
  javaPath: 'java',
  jarUrl: '',
  jarName: 'server.jar',
  backupInterval: 0,
  restartOnCrash: true,
  maxRamPercent: 80,
  serviceUser: 'minecraft',
  serviceDir: '/opt/minecraft',
  serverType: 'vanilla',
  serverVersion: '1.21.1',
};

describe('ServerPreviewPanel 部署标签', () => {
  beforeEach(() => resetStore(BASE_SERVER));

  it('部署标签展示服务端类型与部署目标', () => {
    render(<ServerPreviewPanel />);
    fireEvent.click(screen.getByText('部署'));
    expect(screen.getByLabelText('服务端')).toBeTruthy();
    expect(screen.getByLabelText('部署目标')).toBeTruthy();
    expect(screen.getByText('云服务器部署（24h 在线）')).toBeTruthy();
    expect(screen.getByText('本地开服（局域网联机）')).toBeTruthy();
  });

  it('切换服务端类型写回 store', () => {
    render(<ServerPreviewPanel />);
    fireEvent.click(screen.getByText('部署'));
    fireEvent.change(screen.getByLabelText('服务端'), { target: { value: 'paper' } });
    const spec = useModStore.getState().spec as Record<string, unknown>;
    expect(spec.serverType).toBe('paper');
  });

  it('修改 MC 版本写回 store', () => {
    render(<ServerPreviewPanel />);
    fireEvent.click(screen.getByText('部署'));
    fireEvent.change(screen.getByLabelText('MC 版本（下载用）'), { target: { value: '1.21.11' } });
    const spec = useModStore.getState().spec as Record<string, unknown>;
    expect(spec.serverVersion).toBe('1.21.11');
  });
});
