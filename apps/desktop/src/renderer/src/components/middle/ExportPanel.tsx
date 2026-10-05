import { useState } from 'react';
import { Download, Package, Film, Box, Image as ImageIcon, Video } from 'lucide-react';
import { ExportEngine } from './ExportEngine';
import type { ExportFormat, ResourcePackMeta } from './SkinPixelEditor';

interface ExportPanelProps {
  skinUrl: string | null;
  capeUrl: string | null;
  playerName: string;
  /** v1.3：返回 3D 预览 canvas，用于 GIF/WebM 录制 */
  getViewerCanvas?: () => HTMLCanvasElement | null;
}

const FORMATS: Array<{ id: ExportFormat; label: string; desc: string; icon: React.ReactNode }> = [
  {
    id: 'png',
    label: '皮肤 PNG',
    desc: '64x64 合成纹理',
    icon: <ImageIcon className="h-3.5 w-3.5" />,
  },
  {
    id: 'resourcepack',
    label: '资源包 ZIP',
    desc: 'steve/alex + 披风 + pack.mcmeta',
    icon: <Package className="h-3.5 w-3.5" />,
  },
  {
    id: 'gltf',
    label: 'GLTF 模型',
    desc: '纹理内嵌，可预览结构',
    icon: <Box className="h-3.5 w-3.5" />,
  },
  {
    id: 'gif',
    label: 'GIF 动图',
    desc: '录制 3D 预览动作',
    icon: <Film className="h-3.5 w-3.5" />,
  },
];

export function ExportPanel({ skinUrl, capeUrl, playerName, getViewerCanvas }: ExportPanelProps) {
  const [busy, setBusy] = useState<ExportFormat | 'webm' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [packFormat, setPackFormat] = useState(15);
  const [description, setDescription] = useState(`MC Creator Skin Pack - ${playerName}`);
  const [gifFps, setGifFps] = useState(8);
  const [gifFrames, setGifFrames] = useState(8);
  const [webmSecs, setWebmSecs] = useState(5);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleExport = async (format: ExportFormat) => {
    setError(null);
    try {
      setBusy(format);
      if (format === 'png') {
        if (!skinUrl) {
          setError('没有可导出的皮肤纹理');
          return;
        }
        const blob = await ExportEngine.exportPng(skinUrl);
        downloadBlob(blob, `${playerName}-skin.png`);
      } else if (format === 'resourcepack') {
        if (!skinUrl) {
          setError('没有可导出的皮肤纹理');
          return;
        }
        const meta: ResourcePackMeta = { packFormat, description };
        const blob = (await ExportEngine.export(
          'resourcepack',
          skinUrl,
          capeUrl ? { capeDataUrl: capeUrl, meta } : { meta },
        )) as Blob;
        downloadBlob(blob, `${playerName}-resourcepack.zip`);
      } else if (format === 'gltf') {
        if (!skinUrl) {
          setError('没有可导出的皮肤纹理');
          return;
        }
        const dataUrl = (await ExportEngine.export(
          'gltf',
          skinUrl,
          capeUrl ? { capeDataUrl: capeUrl } : {},
        )) as string;
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${playerName}-skin.gltf`;
        a.click();
      } else if (format === 'gif') {
        const canvas = getViewerCanvas?.() ?? null;
        if (!canvas) {
          setError('需要先打开 3D 预览（进入编辑器视图）再录制 GIF');
          return;
        }
        const frames = await ExportEngine.captureFrames(
          canvas,
          Math.max(2, Math.min(24, gifFrames)),
          Math.round(1000 / Math.max(1, Math.min(15, gifFps))),
          240,
          320,
        );
        const blob = await ExportEngine.exportGif(frames, gifFps);
        downloadBlob(blob, `${playerName}-preview.gif`);
      } else if (format === 'mp4') {
        setError('MP4 需 ffmpeg 后处理；请用下方 WebM 录制（Chrome/Electron 原生支持）');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败');
    } finally {
      setBusy(null);
    }
  };

  const handleRecordWebm = async () => {
    setError(null);
    const canvas = getViewerCanvas?.() ?? null;
    if (!canvas) {
      setError('需要先打开 3D 预览（进入编辑器视图）再录制');
      return;
    }
    try {
      setBusy('webm');
      const blob = await ExportEngine.exportVideo(canvas, Math.max(1, Math.min(15, webmSecs)), 30);
      downloadBlob(blob, `${playerName}-preview.webm`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '录制失败（当前环境可能不支持 MediaRecorder）');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mc-dim">
        <Download className="h-3 w-3" /> 导出套件
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            onClick={() => void handleExport(f.id)}
            disabled={busy !== null}
            className="flex flex-col items-start gap-1 rounded-mc border border-mc-border bg-mc-surface-3 px-2 py-1.5 text-left hover:border-mc-accent disabled:cursor-not-allowed disabled:opacity-40"
            title={f.desc}
          >
            <span className="flex items-center gap-1 text-[11px] text-mc-text">
              {f.icon}
              {busy === f.id ? '导出中…' : f.label}
            </span>
            <span className="text-[10px] text-mc-mute">{f.desc}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-[11px] text-mc-dim">
          <span>GIF</span>
          <label className="flex items-center gap-1">
            帧数
            <input
              type="number"
              min={2}
              max={24}
              value={gifFrames}
              onChange={(e) => setGifFrames(Number(e.target.value))}
              className="w-14 rounded-mc border border-mc-border bg-mc-surface-3 px-1.5 py-0.5 text-[11px] text-mc-text"
            />
          </label>
          <label className="flex items-center gap-1">
            FPS
            <input
              type="number"
              min={1}
              max={15}
              value={gifFps}
              onChange={(e) => setGifFps(Number(e.target.value))}
              className="w-14 rounded-mc border border-mc-border bg-mc-surface-3 px-1.5 py-0.5 text-[11px] text-mc-text"
            />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleRecordWebm()}
            disabled={busy !== null}
            className="flex flex-1 items-center justify-center gap-1 rounded-mc border border-mc-border bg-mc-surface-3 px-2 py-1.5 text-[11px] text-mc-text hover:border-mc-accent disabled:cursor-not-allowed disabled:opacity-40"
            title="用 MediaRecorder 录制 3D 预览（WebM/VP9），如需 MP4 可用 ffmpeg 转码"
          >
            <Video className="h-3.5 w-3.5" />
            {busy === 'webm' ? '录制中…' : '录制 WebM 预览'}
          </button>
          <label className="flex items-center gap-1 text-[11px] text-mc-dim">
            <input
              type="number"
              min={1}
              max={15}
              value={webmSecs}
              onChange={(e) => setWebmSecs(Number(e.target.value))}
              className="w-14 rounded-mc border border-mc-border bg-mc-surface-3 px-1.5 py-0.5 text-[11px] text-mc-text"
            />
            秒
          </label>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-mc-dim">
          pack_format
          <input
            type="number"
            min={1}
            max={99}
            value={packFormat}
            onChange={(e) => setPackFormat(Number(e.target.value))}
            className="w-20 rounded-mc border border-mc-border bg-mc-surface-3 px-1.5 py-0.5 text-[11px] text-mc-text"
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-mc-dim">
          描述
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-w-0 flex-1 rounded-mc border border-mc-border bg-mc-surface-3 px-1.5 py-0.5 text-[11px] text-mc-text"
          />
        </label>
      </div>
      {error && <div className="mt-2 text-[11px] text-red-400">{error}</div>}
    </div>
  );
}
