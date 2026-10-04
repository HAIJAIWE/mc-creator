import { useState } from 'react';
import { SlidersHorizontal, RotateCcw, MousePointerClick } from 'lucide-react';
import { PosePreset, JointAngles } from './SkinPixelEditor';

interface PosePanelProps {
  pose: PosePreset;
  customPose: JointAngles;
  onPoseChange: (preset: PosePreset) => void;
  onCustomPoseChange: (joint: keyof JointAngles, axis: 'x' | 'y' | 'z', value: number) => void;
  onReset: () => void;
}

const PRESETS: { value: PosePreset; label: string; icon: React.ReactNode }[] = [
  { value: 'idle', label: '站立', icon: <MousePointerClick className="h-4 w-4" /> },
  { value: 'walk', label: '行走', icon: <RotateCcw className="h-4 w-4" /> },
  { value: 'run', label: '奔跑', icon: <RotateCcw className="h-4 w-4" /> },
  { value: 'tpose', label: 'T-Pose', icon: <SlidersHorizontal className="h-4 w-4" /> },
  { value: 'fly', label: '飞行', icon: <MousePointerClick className="h-4 w-4" /> },
  { value: 'custom', label: '自定义', icon: <SlidersHorizontal className="h-4 w-4" /> },
];

const JOINTS: (keyof JointAngles)[] = [
  'head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg',
];

const JOINT_LABELS: Record<keyof JointAngles, string> = {
  head: '头部', body: '身体', leftArm: '左臂', rightArm: '右臂', leftLeg: '左腿', rightLeg: '右腿',
};

const AXES: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];

export const PosePanel = ({
  pose,
  customPose,
  onPoseChange,
  onCustomPoseChange,
  onReset,
}: PosePanelProps) => {
  const [expanded, setExpanded] = useState<Record<keyof JointAngles, boolean>>({
    head: false, body: false, leftArm: false, rightArm: false, leftLeg: false, rightLeg: false,
  });

  const handleSliderChange = (joint: keyof JointAngles, axis: 'x' | 'y' | 'z', e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    onCustomPoseChange(joint, axis, value);
  };

  return (
    <div className="bg-mc-surface-2 rounded-mc border border-mc-border p-3 w-72">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-mc-text">姿势控制</h3>
        <button
          onClick={onReset}
          className="text-[11px] text-mc-dim hover:text-mc-text transition-colors"
          title="重置为默认站立姿势"
        >
          重置
        </button>
      </div>

      {/* 预设按钮 */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => onPoseChange(p.value)}
            className={`flex flex-col items-center gap-1 px-2 py-1.5 rounded-mc text-[11px] transition-colors ${
              pose === p.value
                ? 'bg-mc-primary/20 border border-mc-primary text-mc-primary'
                : 'bg-mc-surface-3 text-mc-dim hover:text-mc-text hover:border-mc-border'
            }`}
          >
            {p.icon}
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      {/* 自定义关节控制 */}
      {pose === 'custom' && (
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {JOINTS.map((joint) => (
            <details
              key={joint}
              open={expanded[joint]}
              onToggle={() => setExpanded((prev) => ({ ...prev, [joint]: !prev[joint] }))}
              className="bg-mc-surface-3 rounded-mc border border-mc-border p-2"
            >
              <summary className="flex items-center gap-2 cursor-pointer text-[12px] text-mc-text select-none">
                <span className="w-20 font-medium">{JOINT_LABELS[joint]}</span>
                <span className="text-mc-dim text-[10px]">
                  X: {customPose[joint].x.toFixed(0)}°
                  Y: {customPose[joint].y.toFixed(0)}°
                  Z: {customPose[joint].z.toFixed(0)}°
                </span>
              </summary>
              <div className="mt-2 space-y-1.5">
                {AXES.map((axis) => (
                  <div key={axis} className="flex items-center gap-2">
                    <label className="w-6 text-[11px] text-mc-dim font-mono">{axis.toUpperCase()}</label>
                    <input
                      type="range"
                      min="-180"
                      max="180"
                      step="1"
                      value={customPose[joint][axis]}
                      onChange={(e) => handleSliderChange(joint, axis, e)}
                      className="flex-1 h-2 bg-mc-surface-2 rounded appearance-none accent-mc-primary"
                    />
                    <input
                      type="number"
                      min="-180"
                      max="180"
                      step="1"
                      value={customPose[joint][axis]}
                      onChange={(e) => handleSliderChange(joint, axis, e)}
                      className="w-16 px-1 py-0.5 text-[11px] bg-mc-surface-2 border border-mc-border rounded-mc text-mc-text"
                    />
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}

      {pose !== 'custom' && (
        <div className="text-center py-4 text-mc-mute text-[11px]">
          选择「自定义」解锁关节精细调节
        </div>
      )}
    </div>
  );
};