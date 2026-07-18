import { useId } from 'react';

/** 表单分组容器 */
export function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-mc-dim">{title}</div>
      <div className="space-y-2 rounded-mc-lg border border-mc-border bg-mc-surface-2/40 p-3">
        {children}
      </div>
    </div>
  );
}

/** 文本输入字段 */
export function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-28 shrink-0 text-xs text-mc-dim">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mc-input flex-1 !py-1 !text-xs"
      />
    </div>
  );
}

/** 数字输入字段（clamp 到 [min, max]，允许清空回退到 min） */
export function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '' || raw === '-') {
      onChange(min);
      return;
    }
    const num = parseInt(raw, 10);
    if (Number.isNaN(num)) {
      onChange(min);
      return;
    }
    onChange(Math.max(min, Math.min(max, num)));
  };
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-28 shrink-0 text-xs text-mc-dim">
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={handleChange}
        className="mc-input w-24 !py-1 !text-xs"
      />
    </div>
  );
}

/** 下拉选择字段 */
export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-28 shrink-0 text-xs text-mc-dim">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mc-select flex-1 !py-1 !text-xs"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 开关字段 */
export function ToggleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-28 shrink-0 text-xs text-mc-dim">
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 rounded-full transition-colors ${value ? 'bg-mc-accent' : 'bg-mc-surface-3'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
      <span className="text-xs text-mc-mute">{value ? '开' : '关'}</span>
    </div>
  );
}
