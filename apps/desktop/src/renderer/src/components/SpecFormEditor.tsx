import { useState, useCallback } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';

/** 最大递归深度 */
const MAX_DEPTH = 5;

/** 以 _ 开头的内部字段前缀 */
function isInternalKey(key: string): boolean {
  return key.startsWith('_');
}

/** 标识符类字段（只读） */
function isIdField(key: string): boolean {
  return key === 'id' || key === 'modId' || key === 'packId';
}

/** 判断值是否看起来像颜色 #RRGGBB */
function isColorValue(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface SpecFormEditorProps {
  spec: Record<string, unknown>;
  onChange: (updated: Record<string, unknown>) => void;
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

export function SpecFormEditor({ spec, onChange }: SpecFormEditorProps) {
  return (
    <div className="max-h-[320px] overflow-y-auto px-2 py-1.5">
      <ObjectFields value={spec} depth={0} onChange={onChange} />
    </div>
  );
}

// ─── 对象字段组 ──────────────────────────────────────────────────────────────

interface ObjectFieldsProps {
  value: Record<string, unknown>;
  depth: number;
  onChange: (updated: Record<string, unknown>) => void;
}

function ObjectFields({ value, depth, onChange }: ObjectFieldsProps) {
  const entries = Object.entries(value).filter(([k]) => !isInternalKey(k));

  if (entries.length === 0) {
    return <div className="py-1 text-xs text-mc-mute">（空对象）</div>;
  }

  const updateField = (key: string, fieldValue: unknown) => {
    onChange({ ...value, [key]: fieldValue });
  };

  return (
    <div style={{ paddingLeft: depth > 0 ? 8 : 0 }}>
      {entries.map(([key, val]) => (
        <SpecField
          key={key}
          fieldKey={key}
          value={val}
          depth={depth}
          onChange={(v) => updateField(key, v)}
          onRemove={() => {
            const next = { ...value };
            delete next[key];
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

// ─── 单字段 ──────────────────────────────────────────────────────────────────

interface SpecFieldProps {
  fieldKey: string;
  value: unknown;
  depth: number;
  onChange: (updated: unknown) => void;
  onRemove?: () => void;
}

function SpecField({ fieldKey, value, depth, onChange, onRemove }: SpecFieldProps) {
  if (depth >= MAX_DEPTH) {
    return (
      <div className="flex items-center gap-1.5 py-0.5">
        <span className="text-xs text-mc-dim">{fieldKey}:</span>
        <span className="text-xs text-mc-mute">{JSON.stringify(value)}</span>
      </div>
    );
  }

  if (value === null || value === undefined) {
    return (
      <div className="flex items-center gap-1.5 py-0.5">
        <span className="text-xs text-mc-dim">{fieldKey}:</span>
        <span className="text-xs text-mc-mute">null</span>
        {onRemove && <RemoveButton onClick={onRemove} />}
      </div>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <div className="flex items-center gap-1.5 py-0.5">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => onChange(e.target.checked)}
            className="h-3.5 w-3.5 accent-mc-accent"
          />
          <span className="text-xs text-mc-dim">{fieldKey}</span>
        </label>
        {onRemove && <RemoveButton onClick={onRemove} />}
      </div>
    );
  }

  if (typeof value === 'number') {
    return (
      <div className="flex items-center gap-1.5 py-0.5">
        <span className="min-w-[60px] text-xs text-mc-dim">{fieldKey}</span>
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) onChange(n);
          }}
          className="mc-input !w-24 !py-0.5 text-xs"
        />
        {onRemove && <RemoveButton onClick={onRemove} />}
      </div>
    );
  }

  if (typeof value === 'string') {
    if (isColorValue(value)) {
      return (
        <ColorField fieldKey={fieldKey} value={value} onChange={onChange} onRemove={onRemove} />
      );
    }
    // 长字符串用 textarea
    const str = value as string;
    const isLong = str.length > 80;
    const readOnly = isIdField(fieldKey);
    return (
      <div className="flex items-start gap-1.5 py-0.5">
        <span className="mt-1 min-w-[60px] shrink-0 text-xs text-mc-dim">{fieldKey}</span>
        {isLong ? (
          <textarea
            value={value}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
            className="mc-input min-h-[48px] flex-1 resize-y !py-1 text-xs"
          />
        ) : (
          <input
            type="text"
            value={value}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
            className="mc-input flex-1 !py-0.5 text-xs"
          />
        )}
        {readOnly && <span className="mt-1 shrink-0 text-[10px] text-mc-mute">只读</span>}
        {onRemove && <RemoveButton onClick={onRemove} />}
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <ArrayField
        fieldKey={fieldKey}
        value={value}
        depth={depth}
        onChange={onChange}
        onRemove={onRemove}
      />
    );
  }

  if (typeof value === 'object') {
    return (
      <ObjectField
        fieldKey={fieldKey}
        value={value as Record<string, unknown>}
        depth={depth}
        onChange={onChange}
        onRemove={onRemove}
      />
    );
  }

  // fallback：显示 JSON
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <span className="text-xs text-mc-dim">{fieldKey}:</span>
      <span className="text-xs text-mc-mute">{JSON.stringify(value)}</span>
      {onRemove && <RemoveButton onClick={onRemove} />}
    </div>
  );
}

// ─── 颜色字段 ────────────────────────────────────────────────────────────────

interface ColorFieldProps {
  fieldKey: string;
  value: string;
  onChange: (v: unknown) => void;
  onRemove?: () => void;
}

function ColorField({ fieldKey, value, onChange, onRemove }: ColorFieldProps) {
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <span className="min-w-[60px] text-xs text-mc-dim">{fieldKey}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-6 cursor-pointer rounded border border-mc-border bg-transparent"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mc-input !w-24 !py-0.5 text-xs font-mono"
      />
      {onRemove && <RemoveButton onClick={onRemove} />}
    </div>
  );
}

// ─── 嵌套对象字段 ────────────────────────────────────────────────────────────

interface ObjectFieldProps {
  fieldKey: string;
  value: Record<string, unknown>;
  depth: number;
  onChange: (v: unknown) => void;
  onRemove?: () => void;
}

function ObjectField({ fieldKey, value, depth, onChange, onRemove }: ObjectFieldProps) {
  const [open, setOpen] = useState(depth < 1);

  const handleChildChange = useCallback(
    (updated: Record<string, unknown>) => {
      onChange(updated);
    },
    [onChange],
  );

  const keyCount = Object.keys(value).filter((k) => !isInternalKey(k)).length;

  return (
    <div className="py-0.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 text-xs text-mc-dim hover:text-mc-text"
        >
          {open ? (
            <McIcon scope="pixel" name="chevron-down" size={10} />
          ) : (
            <McIcon scope="pixel" name="chevron-right" size={10} />
          )}
          <span>{fieldKey}</span>
          <span className="text-[10px] text-mc-mute">({keyCount} 项)</span>
        </button>
        {onRemove && <RemoveButton onClick={onRemove} />}
      </div>
      {open && (
        <div className="ml-2 border-l border-mc-border pl-1">
          <ObjectFields value={value} depth={depth + 1} onChange={handleChildChange} />
        </div>
      )}
    </div>
  );
}

// ─── 数组字段 ────────────────────────────────────────────────────────────────

interface ArrayFieldProps {
  fieldKey: string;
  value: unknown[];
  depth: number;
  onChange: (v: unknown) => void;
  onRemove?: () => void;
}

function ArrayField({ fieldKey, value, depth, onChange, onRemove }: ArrayFieldProps) {
  const [open, setOpen] = useState(depth < 1);

  const updateItem = (index: number, itemValue: unknown) => {
    const next = [...value];
    next[index] = itemValue;
    onChange(next);
  };

  const removeItem = (index: number) => {
    const next = [...value];
    next.splice(index, 1);
    onChange(next);
  };

  const addItem = () => {
    // 根据已有项推断新项默认值，否则空对象
    if (
      value.length > 0 &&
      typeof value[0] === 'object' &&
      value[0] !== null &&
      !Array.isArray(value[0])
    ) {
      onChange([...value, {}]);
    } else if (value.length > 0 && typeof value[0] === 'string') {
      onChange([...value, '']);
    } else if (value.length > 0 && typeof value[0] === 'number') {
      onChange([...value, 0]);
    } else {
      onChange([...value, {}]);
    }
  };

  return (
    <div className="py-0.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 text-xs text-mc-dim hover:text-mc-text"
        >
          {open ? (
            <McIcon scope="pixel" name="chevron-down" size={10} />
          ) : (
            <McIcon scope="pixel" name="chevron-right" size={10} />
          )}
          <span>{fieldKey}</span>
          <span className="text-[10px] text-mc-mute">({value.length} 项)</span>
        </button>
        {onRemove && <RemoveButton onClick={onRemove} />}
      </div>
      {open && (
        <div className="ml-2 border-l border-mc-border pl-1">
          {value.map((item, i) => (
            <div key={i} className="flex items-start gap-1 py-0.5">
              <span className="mt-0.5 shrink-0 text-[10px] text-mc-mute">{i}</span>
              <div className="flex-1">
                <SpecField
                  fieldKey=""
                  value={item}
                  depth={depth + 1}
                  onChange={(v) => updateItem(i, v)}
                />
              </div>
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="mt-0.5 shrink-0 text-mc-mute hover:text-mc-redstone"
                title="删除此项"
              >
                <McIcon scope="pixel" name="trash" size={10} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addItem}
            className="mt-0.5 flex items-center gap-1 text-xs text-mc-accent hover:text-mc-accent-bright"
          >
            <McIcon scope="pixel" name="plus" size={10} />
            添加项
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 删除按钮 ────────────────────────────────────────────────────────────────

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 text-mc-mute hover:text-mc-redstone"
      title="删除此字段"
    >
      <McIcon scope="pixel" name="close" size={10} />
    </button>
  );
}
